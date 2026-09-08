/**
 * Journey executor — runs a Journey's recursive node tree.
 *
 *   - request  — existing production flow control (bindings, delay,
 *                retries with backoff, timeouts, conditional skip)
 *   - branch   — evaluates each branch's condition against the previous
 *                response in the enclosing sequence; runs the first match
 *                (a `condition: null` branch is the fallback)
 *   - parallel — runs all lanes concurrently; lanes start from the same
 *                variable snapshot, and their extractions merge back into
 *                the shared scope (last write wins) when all lanes finish
 *
 * `step:N:name` bindings address nodes by depth-first pre-order index over
 * the whole tree (see `dfsNodes`). Pure enough to unit test: `send`,
 * `sleep` and `now` are injectable.
 */

import type { RawRequest, RawResponse } from '@/engine/runner';
import type { SendHandle } from './requestRunner';
import { buildRawRequest, sendRequest } from './requestRunner';
import type { ApiRequest } from './apiTypes';
import { applyExtractRules } from './variables';
import { evaluateAssertions } from '@/engine/core';
import type { Journey, JourneyCondition, JourneyNode } from './journeyTypes';
import { dfsNodes, parseDataset } from './journeyTypes';

/** Snapshot of what was actually sent on the wire (after interpolation). */
export interface JourneySentRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
  timeout: number;
}

/** Result of one request node. */
export interface JourneyStepResult {
  requestId: string;
  /** Interpolated request snapshot, or null when the node was skipped. */
  sent: JourneySentRequest | null;
  response: RawResponse | null;
  /** Names of variables extracted from this response. */
  extracted: string[];
  /** Key/value pairs extracted (for step:N references). */
  extractedPairs: [string, string][];
  /** Assertion failures (empty = all passed / none configured). */
  assertionFailures: string[];
  error: string;
  /** True when the node was skipped by its skipIf condition. */
  skipped: boolean;
  /** Total send attempts (1 + retries actually performed). */
  attempts: number;
}

/** Result of any node — request results are nested for containers. */
export interface JourneyNodeResult {
  nodeId: string;
  kind: JourneyNode['kind'];
  /** request nodes only. */
  request?: JourneyStepResult;
  /** branch: matched branch index (-1 = none matched). */
  branchIndex?: number;
  /** branch: results of the matched branch's nodes. */
  children?: JourneyNodeResult[];
  /** parallel: per-lane node results. */
  lanes?: JourneyNodeResult[][];
  status: 'pass' | 'fail' | 'skip' | 'none';
}

export interface JourneyIterationResult {
  /** Recursive node results mirroring the journey tree. */
  nodeResults: JourneyNodeResult[];
  /** Request results flattened in DFS order (handy for summaries). */
  stepResults: JourneyStepResult[];
  /** Variables seen by this iteration (seed + bindings + extractions). */
  vars: Record<string, string>;
}

export interface JourneyRunReport {
  startedAt: number;
  finishedAt: number;
  /** True when the user stopped the run mid-way. */
  cancelled: boolean;
  iterations: JourneyIterationResult[];
  passedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  /** Total wall time across all iterations. */
  totalMs: number;
  /** Parse error from the dataset, when one occurred (run aborted). */
  dataError: string;
}

export interface JourneyRunOptions {
  requests: Record<string, ApiRequest>;
  journey: Journey;
  /** Seed variables (env + global + extracted merged by the caller). */
  vars: Record<string, string>;
  /** Run the top-level sequence from this node index (0 = from the start). */
  startAt?: number;
  /** Polled between nodes and during sleeps; return true to stop. */
  isCancelled?: () => boolean;
  /** Called after each request node finishes (per iteration). */
  onStepResult?: (iterationIndex: number, nodeIndex: number, result: JourneyStepResult) => void;
  /** Called after every node with the full report so far (live updates). */
  onProgress?: (report: JourneyRunReport) => void;
  send?: (raw: RawRequest) => SendHandle;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Defaults used when a node doesn't override them. */
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_STEP_DELAY_MS = 0;

interface ExecContext {
  requests: Record<string, ApiRequest>;
  journey: Journey;
  iterationIndex: number;
  isCancelled: () => boolean;
  send: (raw: RawRequest) => SendHandle;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Cancellation flag shared across the run. */
  cancelled: { value: boolean };
  /** DFS-indexed node results (null = node not executed). */
  flatResults: (JourneyNodeResult | null)[];
  /** nodeId → DFS index, precomputed over the whole tree. */
  dfsIndex: Map<string, number>;
  onStepResult?: (iterationIndex: number, nodeIndex: number, result: JourneyStepResult) => void;
  onProgress?: (report: JourneyRunReport) => void;
  /** Called by the runner to hand a fresh report snapshot up. */
  snapshot: () => JourneyRunReport;
}

export async function runJourney(options: JourneyRunOptions): Promise<JourneyRunReport> {
  const { journey } = options;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const send = options.send ?? defaultSend;
  const isCancelled = options.isCancelled ?? (() => false);
  const startedAt = now();

  let dataRows: Record<string, string>[];
  let dataError = '';
  try {
    dataRows = parseDataset(journey.data, journey.dataFormat);
  } catch (error) {
    dataError = error instanceof Error ? error.message : String(error);
    dataRows = [];
  }
  if (dataError) {
    return {
      startedAt,
      finishedAt: now(),
      cancelled: false,
      iterations: [],
      passedSteps: 0,
      failedSteps: 0,
      skippedSteps: 0,
      totalMs: 0,
      dataError,
    };
  }

  const iterations: JourneyIterationResult[] = [];
  const rows = dataRows.length > 0 ? dataRows : [{}];
  const cancelled = { value: false };
  const startAt = options.startAt ?? 0;

  // DFS index map over the whole tree (containers included).
  const dfsIndex = new Map<string, number>();
  for (const { node, index } of dfsNodes(journey.steps)) dfsIndex.set(node.id, index);

  const snapshot = (): JourneyRunReport => {
    let passedSteps = 0;
    let failedSteps = 0;
    let skippedSteps = 0;
    for (const iteration of iterations) {
      for (const step of iteration.stepResults) {
        if (step.skipped) skippedSteps++;
        else if (step.error || (step.response && !step.response.ok) || step.assertionFailures.length > 0) failedSteps++;
        else passedSteps++;
      }
    }
    return {
      startedAt,
      finishedAt: now(),
      cancelled: cancelled.value,
      iterations,
      passedSteps,
      failedSteps,
      skippedSteps,
      totalMs: now() - startedAt,
      dataError: '',
    };
  };

  const ctx: ExecContext = {
    requests: options.requests,
    journey,
    iterationIndex: 0,
    isCancelled,
    send,
    sleep,
    now,
    cancelled,
    flatResults: new Array(dfsIndex.size).fill(null),
    dfsIndex,
    onStepResult: options.onStepResult,
    onProgress: options.onProgress,
    snapshot,
  };

  for (let iterationIndex = 0; iterationIndex < rows.length; iterationIndex++) {
    if (cancelled.value || isCancelled()) break;
    ctx.iterationIndex = iterationIndex;
    const runtimeVars: Record<string, string> = { ...options.vars, ...rows[iterationIndex]! };
    const { results } = await runSequence(journey.steps.slice(startAt), ctx, runtimeVars);
    const stepResults: JourneyStepResult[] = [];
    collectRequestResults(results, stepResults);
    iterations.push({ nodeResults: results, stepResults, vars: runtimeVars });
    options.onProgress?.(snapshot());
    if (cancelled.value) break;
  }

  return snapshot();
}

/** True when the condition holds against the given response. */
export function evaluateCondition(condition: JourneyCondition, response: RawResponse): boolean {
  if (condition.source === 'prevStatus') {
    const target = Number(condition.value ?? 0);
    return condition.op === 'eq' ? response.status === target : response.status !== target;
  }
  const body = response.body ?? '';
  const value = condition.value ?? '';
  return condition.op === 'contains' ? body.includes(value) : !body.includes(value);
}

function collectRequestResults(results: JourneyNodeResult[], out: JourneyStepResult[]): void {
  for (const result of results) {
    if (result.kind === 'request' && result.request) out.push(result.request);
    else if (result.children) collectRequestResults(result.children, out);
    else if (result.lanes) for (const lane of result.lanes) collectRequestResults(lane, out);
  }
}

/** Run one node within a sequence; `prevResponse` is the enclosing
 *  sequence's most recent response (used by branch conditions). */
async function runNode(node: JourneyNode, ctx: ExecContext, vars: Record<string, string>, prevResponse: RawResponse | null): Promise<JourneyNodeResult> {
  if (node.kind === 'request') return runRequestNode(node, ctx, vars, prevResponse);
  if (node.kind === 'branch') return runBranchNode(node, ctx, vars, prevResponse);
  return runParallelNode(node, ctx, vars);
}

async function runRequestNode(
  node: Extract<JourneyNode, { kind: 'request' }>,
  ctx: ExecContext,
  vars: Record<string, string>,
  prevResponse: RawResponse | null,
): Promise<JourneyNodeResult> {
  const request = ctx.requests[node.requestId];
  const makeResult = (requestResult: JourneyStepResult): JourneyNodeResult => {
    const result: JourneyNodeResult = { nodeId: node.id, kind: 'request', request: requestResult, status: 'pass' };
    if (requestResult.skipped) result.status = 'skip';
    else if (requestResult.error || (requestResult.response && !requestResult.response.ok) || requestResult.assertionFailures.length > 0) result.status = 'fail';
    const index = ctx.dfsIndex.get(node.id);
    if (index !== undefined) ctx.flatResults[index] = result;
    ctx.onStepResult?.(ctx.iterationIndex, index ?? -1, requestResult);
    return result;
  };

  if (!request) {
    return makeResult({
      requestId: node.requestId,
      sent: null,
      response: null,
      extracted: [],
      extractedPairs: [],
      assertionFailures: [],
      error: 'Node references a deleted request',
      skipped: false,
      attempts: 0,
    });
  }

  // ——— delay before the node ———
  const delayMs = node.delayMs ?? DEFAULT_STEP_DELAY_MS;
  if (delayMs > 0) {
    if (!(await cancellableSleep(ctx.sleep, delayMs, ctx.isCancelled))) {
      ctx.cancelled.value = true;
      return makeResult({
        requestId: node.requestId, sent: null, response: null, extracted: [], extractedPairs: [],
        assertionFailures: [], error: '', skipped: true, attempts: 0,
      });
    }
  }

  // ——— conditional skip ———
  if (node.skipIf && prevResponse && evaluateCondition(node.skipIf, prevResponse)) {
    return makeResult({
      requestId: node.requestId,
      sent: null,
      response: null,
      extracted: [],
      extractedPairs: [],
      assertionFailures: [],
      error: '',
      skipped: true,
      attempts: 0,
    });
  }

  // ——— bindings: rename variables into what this node expects ———
  for (const [target, source] of Object.entries(node.bindings ?? {})) {
    const value = resolveBinding(source, ctx, vars);
    if (value !== undefined) vars[target.trim()] = value;
  }

  const raw = buildRawRequest(request, vars);
  if (node.timeoutMs && node.timeoutMs > 0) raw.timeout = node.timeoutMs;

  const retries = Math.max(0, node.retries ?? DEFAULT_RETRIES);
  const baseRetryDelay = node.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let result: RawResponse | null = null;
  let attempts = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (ctx.isCancelled()) {
      ctx.cancelled.value = true;
      break;
    }
    attempts++;
    result = await ctx.send(raw).promise;
    const retryable = Boolean(result.error) || result.status >= 500;
    if (!retryable || attempt === retries) break;
    const backoff = baseRetryDelay * 2 ** attempt;
    if (!(await cancellableSleep(ctx.sleep, backoff, ctx.isCancelled))) {
      ctx.cancelled.value = true;
      break;
    }
  }
  if (ctx.cancelled.value && !result) {
    return makeResult({
      requestId: node.requestId, sent: null, response: null, extracted: [], extractedPairs: [],
      assertionFailures: [], error: '', skipped: true, attempts,
    });
  }

  const failures =
    request.assertions.length > 0 && result
      ? evaluateAssertions(
          {
            status: result.status,
            ms: result.ms,
            body: result.body,
            ok: result.ok,
            error: result.error,
            responseHeaders: Object.fromEntries(result.headers),
          },
          request.assertions,
        )
      : [];
  const extractedNew = result ? applyExtractRules(result, request.extract) : [];
  const extractedNames: string[] = [];
  for (const [key, value] of extractedNew) {
    vars[key] = value;
    extractedNames.push(key);
  }

  return makeResult({
    requestId: node.requestId,
    sent: { method: raw.method, url: raw.url, headers: raw.headers, body: raw.body, timeout: raw.timeout },
    response: result,
    extracted: extractedNames,
    extractedPairs: [...extractedNew],
    assertionFailures: failures.map((assertion) => `${assertion.type}: ${assertion.value}`),
    error: result?.error ?? '',
    skipped: false,
    attempts,
  });
}

async function runBranchNode(
  node: Extract<JourneyNode, { kind: 'branch' }>,
  ctx: ExecContext,
  vars: Record<string, string>,
  prevResponse: RawResponse | null,
): Promise<JourneyNodeResult> {
  let matched = -1;
  for (let i = 0; i < node.branches.length; i++) {
    const branch = node.branches[i]!;
    if (!branch.condition || (prevResponse && evaluateCondition(branch.condition, prevResponse))) {
      matched = i;
      break;
    }
  }
  const base: JourneyNodeResult = { nodeId: node.id, kind: 'branch', branchIndex: matched, status: 'skip' };
  const index = ctx.dfsIndex.get(node.id);
  if (index !== undefined) ctx.flatResults[index] = base;
  if (matched === -1) {
    ctx.onProgress?.(ctx.snapshot());
    return base;
  }
  const { results, failed } = await runSequence(node.branches[matched]!.steps, ctx, vars);
  const result: JourneyNodeResult = { ...base, children: results, status: failed ? 'fail' : 'pass' };
  if (index !== undefined) ctx.flatResults[index] = result;
  ctx.onProgress?.(ctx.snapshot());
  return result;
}

async function runParallelNode(
  node: Extract<JourneyNode, { kind: 'parallel' }>,
  ctx: ExecContext,
  vars: Record<string, string>,
): Promise<JourneyNodeResult> {
  const base: JourneyNodeResult = { nodeId: node.id, kind: 'parallel', status: 'pass' };
  const index = ctx.dfsIndex.get(node.id);
  if (index !== undefined) ctx.flatResults[index] = base;
  // Lanes start from a snapshot; extractions merge back afterwards.
  const laneVars = node.lanes.map(() => ({ ...vars }));
  const laneRuns = node.lanes.map((lane, laneIndex) => runSequence(lane.steps, ctx, laneVars[laneIndex]!));
  const laneResults = await Promise.all(laneRuns);
  for (const laneVar of laneVars) {
    for (const [key, value] of Object.entries(laneVar)) vars[key] = value;
  }
  const failed = laneResults.some((lane) => lane.failed);
  const result: JourneyNodeResult = {
    ...base,
    lanes: laneResults.map((lane) => lane.results),
    status: failed ? 'fail' : 'pass',
  };
  if (index !== undefined) ctx.flatResults[index] = result;
  ctx.onProgress?.(ctx.snapshot());
  return result;
}

/**
 * Run a sequence (top-level steps, a matched branch, or a lane).
 * `vars` is the shared runtime scope; request extractions write into it.
 */
async function runSequence(
  nodes: JourneyNode[],
  ctx: ExecContext,
  vars: Record<string, string>,
): Promise<{ results: JourneyNodeResult[]; failed: boolean }> {
  const results: JourneyNodeResult[] = [];
  let prevResponse: RawResponse | null = null;
  for (const node of nodes) {
    if (ctx.isCancelled() || ctx.cancelled.value) {
      ctx.cancelled.value = true;
      break;
    }
    const result = await runNode(node, ctx, vars, prevResponse);
    results.push(result);
    if (result.request?.response) prevResponse = result.request.response;
    ctx.onProgress?.(ctx.snapshot());
    if (result.status === 'fail' && ctx.journey.stopOnFailure) break;
  }
  return { results, failed: results.some((result) => result.status === 'fail') };
}

/** `step:N:name` → that node's extracted value; otherwise a runtime var. */
function resolveBinding(source: string, ctx: ExecContext, vars: Record<string, string>): string | undefined {
  const match = /^step:(\d+):(.+)$/.exec(source.trim());
  if (match) {
    const nodeIndex = Number.parseInt(match[1]!, 10);
    const nodeResult = ctx.flatResults[nodeIndex];
    return nodeResult?.request?.extractedPairs.find(([key]) => key === match[2]!)?.[1];
  }
  return vars[source.trim()];
}

/** Sleep that aborts early when cancelled; returns false when cancelled. */
async function cancellableSleep(sleep: (ms: number) => Promise<void>, ms: number, isCancelled: () => boolean): Promise<boolean> {
  // Chunked so a long delay still responds to cancellation promptly.
  const chunk = 100;
  let remaining = ms;
  while (remaining > 0) {
    if (isCancelled()) return false;
    await sleep(Math.min(chunk, remaining));
    remaining -= chunk;
  }
  return !isCancelled();
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultSend(raw: RawRequest): SendHandle {
  return sendRequest(raw);
}