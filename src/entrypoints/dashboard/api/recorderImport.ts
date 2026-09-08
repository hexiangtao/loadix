/**
 * Recorder → workspace import pipeline (pure, unit-tested).
 *
 * Turns a chronological list of RecorderCapture[] into:
 *   - ApiRequest[]  — one per capture, names derived from the URL, redacted
 *                     values kept as `{{name}}` placeholders the user can
 *                     bind to an environment variable;
 *   - a Journey     — the same sequence as replayable request nodes;
 *   - auto-extraction — when a value in a later request (query param, path
 *                     segment, JSON body field, header) exactly matches a
 *                     scalar in an earlier response (JSON or header), the
 *                     earlier node gets an ExtractRule and the later node a
 *                     `step:N:name` binding, so the recorded flow replays
 *                     against fresh data instead of stale literals.
 */

import type { ApiMethod, ApiRequest } from './apiTypes';
import { createApiRequest } from './apiTypes';
import type { ExtractRule } from './variables';
import type { Journey } from './journeyTypes';
import { createJourney, createRequestNode } from './journeyTypes';
import { parseQueryParams } from './urlUtil';
import { restorePlaceholders, type RecorderCapture } from './recorderTypes';

const API_METHODS: readonly ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const SEGMENT_STOP = new Set(['api', 'apis', 'v1', 'v2', 'v3', 'v4', 'index', 'list', 'data', 'root', 'rest']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_RE = /\{\{\s*[\w.-]+\s*\}\}/;

export interface RecorderImportOptions {
  /** Generate a Journey alongside the requests. */
  withJourney: boolean;
  /** Journey name (usually localized, with the host interpolated). */
  journeyName?: string;
}

export interface RecorderImportResult {
  requests: ApiRequest[];
  journey: Journey | null;
  /** Discovered step bindings: [stepIndex, target, source]. */
  bindings: [number, string, string][];
  /** Extract rules added: [stepIndex, rule]. */
  extracts: [number, ExtractRule][];
  warnings: string[];
}

interface Candidate {
  name: string;
  value: string;
  kind: 'query' | 'path' | 'body' | 'header';
}

interface JsonScalarSource {
  path: string;
  value: string;
  kind: 'json';
}

interface HeaderSource {
  path: string;
  value: string;
  kind: 'header';
}

type Source = JsonScalarSource | HeaderSource;

function rid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `x-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** `$.a.b[2].c` — keys escaped with bracket notation when unsafe. */
function buildJsonPath(keys: Array<string | number>): string {
  return `$${keys
    .map((key) =>
      typeof key === 'number'
        ? `[${key}]`
        : /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
          ? `.${key}`
          : `['${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`,
    )
    .join('')}`;
}

/** Walk parsed JSON, collecting every scalar with its JSONPath. */
function collectJsonScalars(node: unknown, keys: Array<string | number>, out: Source[]): void {
  if (node === null || typeof node !== 'object') {
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      out.push({ path: buildJsonPath(keys), value: String(node), kind: 'json' });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectJsonScalars(item, [...keys, i], out));
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    collectJsonScalars(value, [...keys, key], out);
  }
}

function tryParseJson(text: string): unknown | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseResponseSources(capture: RecorderCapture): Source[] {
  const sources: Source[] = [];
  const parsed = tryParseJson(capture.responseBody);
  if (parsed !== null) collectJsonScalars(parsed, [], sources);
  for (const [key, value] of capture.responseHeaders) {
    sources.push({ path: key, value, kind: 'header' });
  }
  return sources;
}

/** Candidates are the places a later request could reference a value. */
function collectCandidates(capture: RecorderCapture): Candidate[] {
  const candidates: Candidate[] = [];
  let url: URL | null = null;
  try {
    url = new URL(capture.url);
  } catch {
    /* keep null */
  }
  if (url) {
    for (const [key, value] of url.searchParams) {
      const v = value.trim();
      if (v && v.length <= 256 && !PLACEHOLDER_RE.test(v)) candidates.push({ name: key, value: v, kind: 'query' });
    }
    for (const rawSegment of url.pathname.split('/')) {
      if (!rawSegment) continue;
      let segment = rawSegment;
      try {
        segment = decodeURIComponent(rawSegment);
      } catch {
        /* keep raw */
      }
      if (!segment || segment.length < 2 || segment.length > 256 || PLACEHOLDER_RE.test(segment)) continue;
      candidates.push({ name: segment, value: segment, kind: 'path' });
    }
  }
  const contentType = capture.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  if (capture.body && /json/i.test(contentType)) {
    const parsed = tryParseJson(capture.body);
    if (parsed !== null) {
      const walk = (node: unknown, key: string | null) => {
        if (node === null || typeof node !== 'object') {
          if (key && (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean')) {
            const v = String(node).trim();
            if (v && v.length <= 256 && !PLACEHOLDER_RE.test(v)) candidates.push({ name: key, value: v, kind: 'body' });
          }
          return;
        }
        if (Array.isArray(node)) {
          node.forEach((item, i) => walk(item, key));
          return;
        }
        for (const [k, value] of Object.entries(node as Record<string, unknown>)) walk(value, k);
      };
      walk(parsed, null);
    }
  }
  for (const [key, value] of capture.headers) {
    const v = value.trim();
    if (v && v.length <= 256 && !PLACEHOLDER_RE.test(v)) candidates.push({ name: key, value: v, kind: 'header' });
  }
  return candidates;
}

function titleCase(segment: string): string {
  const words = segment.replace(/[-_]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return segment;
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 40);
}

/** Friendly unique request name from the URL, e.g. `/api/users/42` → "Users". */
function deriveName(url: string, method: string, used: Set<string>): string {
  let segments: string[] = [];
  let host = '';
  try {
    const u = new URL(url);
    host = u.host;
    segments = u.pathname.split('/').filter(Boolean).map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  } catch {
    /* no URL */
  }
  let base = '';
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!;
    if (SEGMENT_STOP.has(segment.toLowerCase()) || UUID_RE.test(segment) || /^\d+$/.test(segment) || segment.length < 2) continue;
    base = titleCase(segment);
    break;
  }
  if (!base) base = host || method;
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base} ${n++}`;
  used.add(name.toLowerCase());
  return name;
}

/** Sanitize a binding target name; '' when unusable. */
function bindingName(name: string, fallback: string): string {
  const clean = name.trim().replace(/[^\w.-]+/g, '_');
  if (!clean) return fallback;
  return clean;
}

/** Unique variable name for an extract rule. */
function uniqueVarName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base}_${n++}`;
  used.add(name.toLowerCase());
  return name;
}

export function importCaptures(captures: RecorderCapture[], options: RecorderImportOptions): RecorderImportResult {
  const warnings: string[] = [];
  const usable: { capture: RecorderCapture; index: number }[] = [];

  for (let i = 0; i < captures.length; i++) {
    const capture = captures[i]!;
    const method = capture.method.trim().toUpperCase();
    if (!API_METHODS.includes(method as ApiMethod)) {
      warnings.push(`${method || 'Unknown'} ${capture.url.slice(0, 80)} — unsupported method`);
      continue;
    }
    if (!/^https?:\/\//i.test(capture.url)) {
      warnings.push(`${capture.url.slice(0, 80)} — not an http(s) URL`);
      continue;
    }
    usable.push({ capture, index: i });
  }
  if (usable.length === 0) return { requests: [], journey: null, bindings: [], extracts: [], warnings };

  /* ——— 1. Discover extractions: later request values ← earlier responses ——— */
  const sourceCache = new Map<number, Source[]>();
  const sourcesOf = (j: number): Source[] => {
    let list = sourceCache.get(j);
    if (!list) {
      list = parseResponseSources(usable[j]!.capture);
      sourceCache.set(j, list);
    }
    return list;
  };

  /** per usable-index: replacements to apply + bindings to attach */
  const replacements = new Map<number, { kind: Candidate['kind']; name: string; target: string }[]>();
  const ruleBySource = new Map<string, { varName: string; rule: ExtractRule }>();
  const usedVars = new Set<string>();
  const bindings: [number, string, string][] = [];
  const extracts: [number, ExtractRule][] = [];

  for (let i = 1; i < usable.length; i++) {
    const capture = usable[i]!.capture;
    const myReplacements: { kind: Candidate['kind']; name: string; target: string }[] = [];
    for (const candidate of collectCandidates(capture)) {
      // Prefer the nearest earlier response that produced this value.
      for (let j = i - 1; j >= 0; j--) {
        const hit = sourcesOf(j).find((s) => s.value === candidate.value);
        if (!hit) continue;
        const sourceKey = `${j}:${hit.path}`;
        let entry = ruleBySource.get(sourceKey);
        if (!entry) {
          const base = hit.kind === 'header'
            ? bindingName(hit.path, 'header_value')
            : bindingName(hit.path.split('.').pop() ?? '', 'value');
          const varName = uniqueVarName(base || 'value', usedVars);
          const rule: ExtractRule = {
            id: rid(),
            name: varName,
            kind: hit.kind,
            source: hit.path,
          };
          entry = { varName, rule };
          ruleBySource.set(sourceKey, entry);
          extracts.push([j, rule]);
        }
        // Path segments and headers use the extracted variable's name (the
        // placeholder stands in for the whole value); query params and body
        // fields keep their own name, which reads naturally in `{{name}}`.
        const target =
          candidate.kind === 'query' || candidate.kind === 'body'
            ? bindingName(candidate.name, entry.varName)
            : entry.varName;
        bindings.push([i, target, `step:${j}:${entry.varName}`]);
        myReplacements.push({ kind: candidate.kind, name: candidate.name, target });
        break; // nearest response wins for this candidate
      }
    }
    if (myReplacements.length > 0) replacements.set(i, myReplacements);
  }

  /* ——— 2. Build requests (applying replacements) ——— */
  const requests: ApiRequest[] = [];
  const usedNames = new Set<string>();
  const requestIdByStep = new Map<number, string>();

  for (let i = 0; i < usable.length; i++) {
    const { capture } = usable[i]!;
    const request = createApiRequest();
    request.method = capture.method.trim().toUpperCase() as ApiMethod;
    let url = capture.url;
    const myReplacements = replacements.get(i) ?? [];
    try {
      const parsed = new URL(url);
      for (const r of myReplacements) {
        if (r.kind === 'query') parsed.searchParams.set(r.name, `{{${r.target}}}`);
        if (r.kind === 'path') {
          const decoded = decodeURIComponent(r.name);
          const encoded = encodeURIComponent(decoded);
          parsed.pathname = parsed.pathname.replace(encoded, `{{${r.target}}}`).replace(decoded, `{{${r.target}}}`);
        }
      }
      url = restorePlaceholders(parsed.toString());
    } catch {
      /* keep raw url */
    }
    request.url = url;
    request.params = parseQueryParams(url);
    request.headers = capture.headers.filter(([key]) => !/^(content-length|accept-encoding|connection|host)$/i.test(key));
    for (const r of myReplacements) {
      if (r.kind === 'header') {
        request.headers = request.headers.map(([key, value]) => (key === r.name ? [key, `{{${r.target}}}`] : [key, value]));
      }
    }
    request.name = deriveName(url, request.method, usedNames);

    if (capture.body !== null) {
      const contentType = capture.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
      if (/json/i.test(contentType)) {
        request.body = { type: 'json', content: capture.body, form: [], gqlVariables: '' };
      } else if (/application\/x-www-form-urlencoded/i.test(contentType)) {
        request.body = { type: 'form', content: '', form: parseFormPairs(capture.body), gqlVariables: '' };
      } else {
        request.body = { type: 'text', content: capture.body, form: [], gqlVariables: '' };
      }
    }
    // Attach discovered extract rules (step = the response provider).
    const rules = extracts.filter(([step]) => step === i).map(([, rule]) => rule);
    if (rules.length > 0) request.extract = rules;

    requests.push(request);
    requestIdByStep.set(i, request.id);
  }

  /* ——— 3. Journey ——— */
  let journey: Journey | null = null;
  if (options.withJourney) {
    let host = '';
    try {
      host = new URL(usable[0]!.capture.url).host;
    } catch {
      /* keep empty */
    }
    journey = createJourney(options.journeyName?.replace('{{host}}', host) || `Recorded flow · ${host}`);
    journey.stopOnFailure = false;
    journey.steps = usable.map((_, position) => {
      const node = createRequestNode(requestIdByStep.get(position)!);
      const nodeBindings: Record<string, string> = {};
      for (const [step, target, source] of bindings) {
        if (step === position) nodeBindings[target] = source;
      }
      if (Object.keys(nodeBindings).length > 0) node.bindings = nodeBindings;
      return node;
    });
  }

  return { requests, journey, bindings, extracts, warnings };
}

/** Parse `a=1&b=2` into form pairs (values left encoded like the original). */
function parseFormPairs(body: string): [string, string][] {
  return body
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      return eq < 0 ? [pair, ''] : [pair.slice(0, eq), pair.slice(eq + 1)];
    });
}