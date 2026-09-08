import { describe, expect, it, vi } from 'vitest';
import { runJourney, type JourneyRunReport } from './journeyRunner';
import {
  createBranch,
  createBranchNode,
  createJourney,
  createLane,
  createParallelNode,
  createRequestNode,
  normalizeJourney,
  parseCsv,
  parseDataset,
  type Journey,
  type JourneyNode,
} from './journeyTypes';
import type { ApiRequest, ApiResponse } from './apiTypes';
import { createApiRequest } from './apiTypes';
import type { RawRequest, RawResponse } from '@/engine/runner';

function makeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return { ...createApiRequest(), ...overrides };
}

/** Request node helper for tests. */
function rn(requestId: string, overrides: Partial<ReturnType<typeof createRequestNode>> = {}): JourneyNode {
  return { ...createRequestNode(requestId), ...overrides };
}

function okResponse(status = 200, body = '{"ok":true}'): RawResponse {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    ok: status >= 200 && status < 300,
    headers: [['content-type', 'application/json']],
    body,
    ms: 12,
    bytes: body.length,
    finalUrl: 'http://test/',
    error: '',
    errorKind: '',
  };
}

function errResponse(message: string, status = 0): RawResponse {
  return {
    status,
    statusText: 'ERR',
    ok: false,
    headers: [],
    body: '',
    ms: 5,
    bytes: 0,
    finalUrl: 'http://test/',
    error: message,
    errorKind: 'network',
  };
}

/** Fake sender: plays back a scripted list of responses, one per call. */
function scriptedSend(script: RawResponse[]) {
  let calls = 0;
  const send = vi.fn((raw: RawRequest) => {
    const response = script[calls] ?? okResponse();
    calls++;
    return { promise: Promise.resolve(response), abort: () => {} };
  });
  return { send, count: () => calls };
}

function zeroSleep() {
  return vi.fn(async () => {});
}

function run(opts: {
  journey: Journey;
  requests?: ApiRequest[];
  vars?: Record<string, string>;
  send?: (raw: RawRequest) => { promise: Promise<RawResponse>; abort: () => void };
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
  startAt?: number;
}): Promise<JourneyRunReport> {
  const requests: Record<string, ApiRequest> = {};
  for (const r of opts.requests ?? []) requests[r.id] = r;
  return runJourney({
    requests,
    journey: normalizeJourney(opts.journey),
    vars: opts.vars ?? {},
    send: opts.send,
    sleep: opts.sleep ?? zeroSleep(),
    isCancelled: opts.isCancelled,
    startAt: opts.startAt,
  });
}

describe('runJourney — sequencing & variables', () => {
  it('runs nodes in order and accumulates extracted variables', async () => {
    const first = makeRequest({
      name: 'login',
      url: 'http://x/login',
      extract: [{ id: 'e1', name: 'token', kind: 'json', source: '$.token' }],
    });
    const second = makeRequest({ name: 'me', url: 'http://x/me?t={{token}}' });
    const journey = createJourney('j');
    journey.steps = [rn(first.id), rn(second.id)];
    const { send } = scriptedSend([okResponse(200, '{"token":"abc"}'), okResponse(200)]);

    const report = await run({ journey, requests: [first, second], send });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0].url).toBe('http://x/login');
    expect(send.mock.calls[1]![0].url).toBe('http://x/me?t=abc');
    expect(report.passedSteps).toBe(2);
    expect(report.iterations[0]!.stepResults).toHaveLength(2);
    expect(report.iterations[0]!.nodeResults).toHaveLength(2);
  });

  it('applies bindings: target ← runtime source and step:N source', async () => {
    const login = makeRequest({
      name: 'login',
      url: 'http://x/login',
      extract: [{ id: 'e1', name: 'userId', kind: 'json', source: '$.id' }],
    });
    const uses = makeRequest({ name: 'uses', url: 'http://x/u/{{owner}}' });
    const journey = createJourney('j');
    journey.steps = [
      rn(login.id),
      rn(uses.id, { bindings: { owner: 'userId' } }),
    ];
    const { send } = scriptedSend([okResponse(200, '{"id":"42"}'), okResponse(200)]);
    await run({ journey, requests: [login, uses], send });
    expect(send.mock.calls[1]![0].url).toBe('http://x/u/42');

    // Step-scoped reference by DFS index.
    const step2 = makeRequest({ name: 'direct', url: 'http://x/{{firstId}}' });
    const journey3 = createJourney('j3');
    journey3.steps = [
      rn(login.id),
      rn(step2.id, { bindings: { firstId: 'step:0:userId' } }),
    ];
    const { send: send3 } = scriptedSend([okResponse(200, '{"id":"99"}'), okResponse(200)]);
    await run({ journey: journey3, requests: [login, step2], send: send3 });
    expect(send3.mock.calls[1]![0].url).toBe('http://x/99');
  });

  it('resolves nested env vars through buildRawRequest', async () => {
    const req = makeRequest({ url: '{{baseUrl}}/ping' });
    const journey = createJourney('j');
    journey.steps = [rn(req.id)];
    const { send } = scriptedSend([okResponse(200)]);
    await run({ journey, requests: [req], vars: { baseUrl: 'https://{{host}}', host: 'api.example.com' }, send });
    expect(send.mock.calls[0]![0].url).toBe('https://api.example.com/ping');
  });
});

describe('runJourney — failure policy', () => {
  it('stops after the first failure when stopOnFailure is set', async () => {
    const a = makeRequest({ name: 'a', url: 'http://x/a' });
    const b = makeRequest({ name: 'b', url: 'http://x/b' });
    const journey = createJourney('j');
    journey.stopOnFailure = true;
    journey.steps = [rn(a.id), rn(b.id)];
    const { send } = scriptedSend([okResponse(500), okResponse(200)]);
    const report = await run({ journey, requests: [a, b], send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(report.failedSteps).toBe(1);
    expect(report.iterations[0]!.stepResults).toHaveLength(1);
  });

  it('continues after a failure when stopOnFailure is off', async () => {
    const a = makeRequest({ name: 'a', url: 'http://x/a' });
    const b = makeRequest({ name: 'b', url: 'http://x/b' });
    const journey = createJourney('j');
    journey.stopOnFailure = false;
    journey.steps = [rn(a.id), rn(b.id)];
    const { send } = scriptedSend([okResponse(500), okResponse(200)]);
    const report = await run({ journey, requests: [a, b], send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(report.failedSteps).toBe(1);
    expect(report.passedSteps).toBe(1);
  });

  it('records assertion failures and stops when configured', async () => {
    const a = makeRequest({
      name: 'a',
      url: 'http://x/a',
      assertions: [{ type: 'status', value: '201' }],
    });
    const journey = createJourney('j');
    journey.steps = [rn(a.id)];
    const { send } = scriptedSend([okResponse(200)]);
    const report = await run({ journey, requests: [a], send });
    const result = report.iterations[0]!.stepResults[0]!;
    expect(result.assertionFailures.length).toBeGreaterThan(0);
    expect(report.failedSteps).toBe(1);
  });
});

describe('runJourney — retries & delays', () => {
  it('retries 5xx/network errors with doubling backoff and records attempts', async () => {
    const req = makeRequest({ name: 'a', url: 'http://x/a' });
    const journey = createJourney('j');
    journey.steps = [rn(req.id, { retries: 2, retryDelayMs: 100 })];
    const { send } = scriptedSend([okResponse(500), okResponse(502), okResponse(200)]);
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    const report = await run({ journey, requests: [req], send, sleep });
    expect(send).toHaveBeenCalledTimes(3);
    expect(report.iterations[0]!.stepResults[0]!.attempts).toBe(3);
    expect(sleeps.every((ms) => ms <= 100)).toBe(true);
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(300);
    expect(report.passedSteps).toBe(1);
  });

  it('does not retry on 4xx', async () => {
    const req = makeRequest({ name: 'a', url: 'http://x/a' });
    const journey = createJourney('j');
    journey.steps = [rn(req.id, { retries: 2 })];
    const { send } = scriptedSend([okResponse(404)]);
    await run({ journey, requests: [req], send });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sleeps the configured delay before a node', async () => {
    const a = makeRequest({ name: 'a', url: 'http://x/a' });
    const b = makeRequest({ name: 'b', url: 'http://x/b' });
    const journey = createJourney('j');
    journey.steps = [rn(a.id), rn(b.id, { delayMs: 500 })];
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    const { send } = scriptedSend([okResponse(200), okResponse(200)]);
    await run({ journey, requests: [a, b], send, sleep });
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(500);
  });
});

describe('runJourney — conditional skip', () => {
  it('skips a node when the previous status matches the condition', async () => {
    const a = makeRequest({ name: 'a', url: 'http://x/a' });
    const b = makeRequest({ name: 'b', url: 'http://x/b' });
    const journey = createJourney('j');
    journey.steps = [rn(a.id), rn(b.id, { skipIf: { source: 'prevStatus', op: 'eq', value: '200' } })];
    const { send } = scriptedSend([okResponse(200), okResponse(200)]);
    const report = await run({ journey, requests: [a, b], send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(report.iterations[0]!.stepResults[1]!.skipped).toBe(true);
    expect(report.skippedSteps).toBe(1);
  });

  it('runs the node when the condition does not hold', async () => {
    const a = makeRequest({ name: 'a', url: 'http://x/a' });
    const b = makeRequest({ name: 'b', url: 'http://x/b' });
    const journey = createJourney('j');
    journey.stopOnFailure = false;
    journey.steps = [rn(a.id), rn(b.id, { skipIf: { source: 'prevStatus', op: 'eq', value: '200' } })];
    const { send } = scriptedSend([okResponse(404), okResponse(200)]);
    const report = await run({ journey, requests: [a, b], send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(report.iterations[0]!.stepResults[1]!.skipped).toBe(false);
  });
});

describe('runJourney — branches', () => {
  it('runs the first matching branch only', async () => {
    const setup = makeRequest({ name: 'setup', url: 'http://x/setup' });
    const on200 = makeRequest({ name: 'on200', url: 'http://x/on200' });
    const on404 = makeRequest({ name: 'on404', url: 'http://x/on404' });
    const after = makeRequest({ name: 'after', url: 'http://x/after' });
    const journey = createJourney('j');
    const branch = createBranchNode();
    branch.branches = [
      { ...createBranch({ source: 'prevStatus', op: 'eq', value: '200' }), steps: [rn(on200.id)] },
      { ...createBranch({ source: 'prevStatus', op: 'eq', value: '404' }), steps: [rn(on404.id)] },
    ];
    journey.steps = [rn(setup.id), branch, rn(after.id)];
    const { send } = scriptedSend([okResponse(200), okResponse(200), okResponse(200)]);
    const report = await run({ journey, requests: [setup, on200, on404, after], send });
    expect(send.mock.calls.map((call) => call[0].url)).toEqual(['http://x/setup', 'http://x/on200', 'http://x/after']);
    expect(report.iterations[0]!.nodeResults[1]!.branchIndex).toBe(0);
    expect(report.passedSteps).toBe(3);
  });

  it('skips the branch when no condition matches', async () => {
    const setup = makeRequest({ name: 'setup', url: 'http://x/setup' });
    const on200 = makeRequest({ name: 'on200', url: 'http://x/on200' });
    const journey = createJourney('j');
    journey.stopOnFailure = false;
    const branch = createBranchNode();
    branch.branches = [{ ...createBranch({ source: 'prevStatus', op: 'eq', value: '200' }), steps: [rn(on200.id)] }];
    journey.steps = [rn(setup.id), branch];
    const { send } = scriptedSend([okResponse(404)]);
    const report = await run({ journey, requests: [setup, on200], send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(report.iterations[0]!.nodeResults[1]!.branchIndex).toBe(-1);
    expect(report.iterations[0]!.nodeResults[1]!.status).toBe('skip');
    expect(report.skippedSteps).toBe(0); // skippedSteps counts request steps only — the branch node carries none
  });

  it('uses the fallback branch when present', async () => {
    const setup = makeRequest({ name: 'setup', url: 'http://x/setup' });
    const on200 = makeRequest({ name: 'on200', url: 'http://x/on200' });
    const fallback = makeRequest({ name: 'fallback', url: 'http://x/fallback' });
    const journey = createJourney('j');
    journey.stopOnFailure = false;
    const branch = createBranchNode();
    branch.branches = [
      { ...createBranch({ source: 'prevStatus', op: 'eq', value: '200' }), steps: [rn(on200.id)] },
      { ...createBranch(null), steps: [rn(fallback.id)] },
    ];
    journey.steps = [rn(setup.id), branch];
    const { send } = scriptedSend([okResponse(404), okResponse(200)]);
    const report = await run({ journey, requests: [setup, on200, fallback], send });
    expect(send.mock.calls.map((call) => call[0].url)).toEqual(['http://x/setup', 'http://x/fallback']);
    expect(report.iterations[0]!.nodeResults[1]!.branchIndex).toBe(1);
  });

  it('stops on failure inside a branch when stopOnFailure is set', async () => {
    const setup = makeRequest({ name: 'setup', url: 'http://x/setup' });
    const failing = makeRequest({ name: 'failing', url: 'http://x/failing' });
    const after = makeRequest({ name: 'after', url: 'http://x/after' });
    const journey = createJourney('j');
    const branch = createBranchNode();
    branch.branches = [{ ...createBranch(null), steps: [rn(failing.id)] }];
    journey.steps = [rn(setup.id), branch, rn(after.id)];
    const { send } = scriptedSend([okResponse(200), okResponse(500)]);
    const report = await run({ journey, requests: [setup, failing, after], send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(report.iterations[0]!.nodeResults[1]!.status).toBe('fail');
    expect(report.failedSteps).toBe(1);
  });
});

describe('runJourney — parallel', () => {
  it('runs all lanes concurrently and merges extractions', async () => {
    const lane1 = makeRequest({
      name: 'lane1',
      url: 'http://x/l1',
      extract: [{ id: 'e1', name: 'fromLane1', kind: 'json', source: '$.v' }],
    });
    const lane2 = makeRequest({
      name: 'lane2',
      url: 'http://x/l2',
      extract: [{ id: 'e2', name: 'fromLane2', kind: 'json', source: '$.v' }],
    });
    const after = makeRequest({ name: 'after', url: 'http://x/after?x={{fromLane1}}&y={{fromLane2}}' });
    const journey = createJourney('j');
    const parallel = createParallelNode();
    parallel.lanes = [createLane(), createLane()];
    parallel.lanes[0]!.steps = [rn(lane1.id)];
    parallel.lanes[1]!.steps = [rn(lane2.id)];
    journey.steps = [parallel, rn(after.id)];
    const { send } = scriptedSend([okResponse(200, '{"v":"A"}'), okResponse(200, '{"v":"B"}'), okResponse(200)]);
    const report = await run({ journey, requests: [lane1, lane2, after], send });
    // Both lanes' requests went out before the after-request.
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]![0].url).toBe('http://x/after?x=A&y=B');
    expect(report.iterations[0]!.nodeResults[0]!.lanes).toHaveLength(2);
    expect(report.passedSteps).toBe(3);
  });

  it('overlaps lane execution (interleaved sleeps)', async () => {
    const a = makeRequest({ name: 'a', url: 'http://x/a' });
    const b = makeRequest({ name: 'b', url: 'http://x/b' });
    const journey = createJourney('j');
    const parallel = createParallelNode();
    parallel.lanes = [
      { ...createLane(), steps: [rn(a.id, { delayMs: 60 })] },
      { ...createLane(), steps: [rn(b.id, { delayMs: 30 })] },
    ];
    journey.steps = [parallel];
    const events: string[] = [];
    const sleep = vi.fn(async (ms: number) => {
      events.push(`sleep ${ms}`);
    });
    const send = vi.fn(() => {
      events.push('send');
      return { promise: Promise.resolve(okResponse(200)), abort: () => {} };
    });
    await run({ journey, requests: [a, b], send, sleep });
    // Lane 2's 30ms sleep must complete before lane 1's 60ms sleep does —
    // i.e. the sleeps interleave (proves concurrency, not sequential).
    const firstSend = events.indexOf('send');
    const sleepsBeforeFirstSend = events.slice(0, firstSend).filter((e) => e.startsWith('sleep'));
    expect(sleepsBeforeFirstSend.length).toBeGreaterThanOrEqual(2);
  });

  it('fails the parallel node when a lane fails with stopOnFailure', async () => {
    const ok1 = makeRequest({ name: 'ok', url: 'http://x/ok' });
    const bad = makeRequest({ name: 'bad', url: 'http://x/bad' });
    const after = makeRequest({ name: 'after', url: 'http://x/after' });
    const journey = createJourney('j');
    const parallel = createParallelNode();
    parallel.lanes = [
      { ...createLane(), steps: [rn(ok1.id)] },
      { ...createLane(), steps: [rn(bad.id)] },
    ];
    journey.steps = [parallel, rn(after.id)];
    const { send } = scriptedSend([okResponse(200), okResponse(500)]);
    const report = await run({ journey, requests: [ok1, bad, after], send });
    expect(report.iterations[0]!.nodeResults[0]!.status).toBe('fail');
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('runJourney — nested binding via DFS index', () => {
  it('resolves step:N references to nodes inside containers', async () => {
    const login = makeRequest({
      name: 'login',
      url: 'http://x/login',
      extract: [{ id: 'e1', name: 'userId', kind: 'json', source: '$.id' }],
    });
    const inner = makeRequest({ name: 'inner', url: 'http://x/inner/{{uid}}' });
    const after = makeRequest({ name: 'after', url: 'http://x/after' });
    const journey = createJourney('j');
    const branch = createBranchNode();
    branch.branches = [{ ...createBranch(null), steps: [rn(inner.id, { bindings: { uid: 'step:0:userId' } })] }];
    // DFS: 0=login, 1=branch, 2=inner, 3=after
    journey.steps = [rn(login.id), branch, rn(after.id)];
    const { send } = scriptedSend([okResponse(200, '{"id":"77"}'), okResponse(200), okResponse(200)]);
    await run({ journey, requests: [login, inner, after], send });
    expect(send.mock.calls[1]![0].url).toBe('http://x/inner/77');
  });
});

describe('runJourney — iteration', () => {
  it('runs the flow once per JSON dataset row, injecting row vars', async () => {
    const req = makeRequest({ name: 'a', url: 'http://x/users/{{id}}' });
    const journey = createJourney('j');
    journey.data = '[{"id":"1"},{"id":"2"}]';
    journey.dataFormat = 'json';
    journey.steps = [rn(req.id)];
    const { send } = scriptedSend([okResponse(200), okResponse(200)]);
    const report = await run({ journey, requests: [req], send });
    expect(report.iterations).toHaveLength(2);
    expect(send.mock.calls[0]![0].url).toBe('http://x/users/1');
    expect(send.mock.calls[1]![0].url).toBe('http://x/users/2');
    expect(report.passedSteps).toBe(2);
  });

  it('parses CSV datasets with quoted commas', async () => {
    const rows = parseDataset('name,note\nalice,"hello, world"\nbob,"say ""hi"""', 'csv');
    expect(rows).toEqual([
      { name: 'alice', note: 'hello, world' },
      { name: 'bob', note: 'say "hi"' },
    ]);
  });

  it('reports dataset parse errors without running', async () => {
    const req = makeRequest({ name: 'a', url: 'http://x/a' });
    const journey = createJourney('j');
    journey.data = '[{"id":}]';
    journey.dataFormat = 'json';
    journey.steps = [rn(req.id)];
    const { send } = scriptedSend([okResponse(200)]);
    const report = await run({ journey, requests: [req], send });
    expect(send).not.toHaveBeenCalled();
    expect(report.dataError.length).toBeGreaterThan(0);
  });
});

describe('runJourney — control', () => {
  it('cancels mid-run when the flag flips', async () => {
    const a = makeRequest({ name: 'a', url: 'http://x/a' });
    const b = makeRequest({ name: 'b', url: 'http://x/b' });
    const journey = createJourney('j');
    journey.steps = [rn(a.id), rn(b.id)];
    let cancelled = false;
    const send = vi.fn(() => {
      cancelled = true;
      return { promise: Promise.resolve(okResponse(200)), abort: () => {} };
    });
    const report = await run({ journey, requests: [a, b], send, isCancelled: () => cancelled });
    expect(send).toHaveBeenCalledTimes(1);
    expect(report.cancelled).toBe(true);
  });

  it('runs from a given node index', async () => {
    const a = makeRequest({ name: 'a', url: 'http://x/a' });
    const b = makeRequest({ name: 'b', url: 'http://x/b' });
    const journey = createJourney('j');
    journey.steps = [rn(a.id), rn(b.id)];
    const { send } = scriptedSend([okResponse(200)]);
    const report = await run({ journey, requests: [a, b], send, startAt: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].url).toBe('http://x/b');
    expect(report.iterations[0]!.stepResults).toHaveLength(1);
  });

  it('reports a missing request as a failed node', async () => {
    const journey = createJourney('j');
    journey.steps = [rn('missing')];
    const report = await run({ journey, requests: [] });
    expect(report.failedSteps).toBe(1);
  });
});

describe('normalizeJourney & tree helpers', () => {
  it('migrates legacy linear steps into request nodes', () => {
    const legacy = createJourney('legacy');
    legacy.steps = [
      { requestId: 'r1', bindings: { a: 'b' } } as unknown as JourneyNode,
      { requestId: 'r2' } as unknown as JourneyNode,
    ];
    const normalized = normalizeJourney(legacy);
    expect(normalized.steps[0]!.kind).toBe('request');
    expect((normalized.steps[0] as { requestId: string }).requestId).toBe('r1');
    expect((normalized.steps[0] as { bindings: Record<string, string> }).bindings).toEqual({ a: 'b' });
    expect(normalized.steps[1]!.kind).toBe('request');
  });

  it('leaves already-normalized journeys untouched', () => {
    const journey = createJourney('j');
    journey.steps = [rn('r1')];
    expect(normalizeJourney(journey)).toBe(journey);
  });

  it('addresses nodes inside containers by DFS index', async () => {
    const outer = makeRequest({ name: 'outer', url: 'http://x/outer' });
    const inner = makeRequest({
      name: 'inner',
      url: 'http://x/inner',
      extract: [{ id: 'e1', name: 'v', kind: 'json', source: '$.v' }],
    });
    const tail = makeRequest({ name: 'tail', url: 'http://x/tail/{{iv}}' });
    const journey = createJourney('j');
    const branch = createBranchNode();
    branch.branches = [{ ...createBranch(null), steps: [rn(inner.id)] }];
    // DFS: 0=outer, 1=branch, 2=inner, 3=tail
    journey.steps = [rn(outer.id), branch, rn(tail.id, { bindings: { iv: 'step:2:v' } })];
    const { send } = scriptedSend([okResponse(200), okResponse(200, '{"v":"deep"}'), okResponse(200)]);
    await run({ journey, requests: [outer, inner, tail], send });
    expect(send.mock.calls[2]![0].url).toBe('http://x/tail/deep');
  });
});

describe('parseCsv', () => {
  it('handles CRLF, empty trailing cells, and blank rows', () => {
    const rows = parseCsv('a,b,c\r\n1,2,\r\n3,4,5\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
      ['3', '4', '5'],
    ]);
  });
});