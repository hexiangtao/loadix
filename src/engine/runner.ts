/** Single HTTP request execution with timeout + variable interpolation. */

import type { RequestResult, TestConfig } from '../shared/types';
import { buildHeaders, evaluateAssertions, interpolate } from './core';

/**
 * Outcome of a connectivity probe — a deliberately narrow shape that the
 * "Test Connection" button can render without having to know about the
 * full RequestResult / assertion / timing model.
 */
export interface ProbeResult {
  ok: boolean;
  status: number;
  ms: number;
  bytes: number;
  error: string;
  /** A short label describing the failure mode (`timeout`, `network`, `dns`, …). */
  errorKind: 'timeout' | 'network' | 'dns' | 'cors' | 'aborted' | 'http' | '';
  finalUrl: string;
}

/* ————————————————————————————————————————————————————————————————
 * Raw single-request execution — shared with the Requests module
 * (an API client). The load engine wraps it in TestConfig/RequestResult
 * semantics; the Requests module calls it directly through the
 * background service worker (CORS-free) or in-page on the web build.
 *
 * Deliberately dumb about everything except HTTP: it performs the fetch
 * with a timeout and returns a flat RawResponse. Variable interpolation
 * and header/body assembly are the caller's job (see executeRequest).
 * ———————————————————————————————————————————————————————————————— */

export type RawErrorKind = '' | 'timeout' | 'network' | 'dns' | 'cors' | 'aborted' | 'http';

export interface RawRequest {
  method: string;
  url: string;
  /** Already-interpolated key/value pairs. */
  headers: [string, string][];
  /** Already-interpolated body; only sent for non-GET/HEAD methods. */
  body?: string;
  timeout: number;
}

export interface RawResponse {
  status: number;
  statusText: string;
  ok: boolean;
  /** One row per header name; duplicate values are already joined by the
   *  Fetch API (`, `) the same way captureResponseHeaders used to do. */
  headers: [string, string][];
  body: string;
  ms: number;
  bytes: number;
  finalUrl: string;
  error: string;
  errorKind: RawErrorKind;
}

/**
 * Heuristic failure classification — the Fetch API doesn't expose a stable
 * error type, so we sniff the message. Each branch maps to a stable UI
 * colour/icon so users can diagnose at a glance.
 */
export function classifyError(e: unknown): RawErrorKind {
  const err = e as Error & { cause?: unknown };
  const message = err.message || String(err);
  if (err.name === 'AbortError') return 'timeout';
  if (/Failed to fetch|NetworkError|network/i.test(message)) return 'network';
  if (/DNS|getaddrinfo|ENOTFOUND|hostname/i.test(message)) return 'dns';
  if (/CORS|cors|Access-Control/i.test(message)) return 'cors';
  if (/aborted/i.test(message)) return 'aborted';
  return 'network';
}

/**
 * Execute a single HTTP request. No interpolation, no assertions — the
 * caller resolves variables and builds headers before calling.
 *
 * An optional external signal lets the caller cancel in-flight requests
 * (the Requests module's Stop button); cancels are classified as `aborted`
 * to distinguish them from internal timeout aborts.
 */
export async function executeRawRequest(raw: RawRequest, opts?: { signal?: AbortSignal }): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, raw.timeout));
  const external = opts?.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort);
  }
  const started = performance.now();
  const method = raw.method.toUpperCase();
  const headers: Record<string, string> = {};
  for (const [key, value] of raw.headers) headers[key] = value;
  const body = raw.body && method !== 'GET' && method !== 'HEAD' ? raw.body : undefined;

  try {
    // Wipe the previous run's entries — getEntriesByName would otherwise
    // return every historical entry matching the URL and we'd mis-attribute
    // them to the latest request.
    performance.clearResourceTimings();
  } catch {
    /* not supported everywhere */
  }

  try {
    const res = await fetch(raw.url, {
      method,
      headers,
      body,
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    const ms = performance.now() - started;
    return {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      headers: Array.from(res.headers.entries()),
      body: text,
      ms,
      bytes: new TextEncoder().encode(text).length,
      finalUrl: res.url,
      error: '',
      errorKind: '',
    };
  } catch (e) {
    const ms = performance.now() - started;
    const err = e instanceof Error ? e : new Error(String(e));
    return {
      status: 0,
      statusText: '',
      ok: false,
      headers: [],
      body: '',
      ms,
      bytes: 0,
      finalUrl: raw.url,
      error: err.message,
      // An external cancel reads as "aborted", an internal timeout as
      // "timeout" — the UI labels them differently.
      errorKind: external?.aborted ? 'aborted' : classifyError(e),
    };
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Pull timing breakdown out of the Performance API. The browser's
 * PerformanceResourceTiming covers everything from DNS through body
 * download; we project the bits that load-test users actually care about.
 * Any missing field (e.g. cross-origin timing restrictions) is left as
 * undefined so the UI can render "n/a".
 */
function captureTiming(url: string, totalMs: number): RequestResult['timing'] {
  let entries: PerformanceEntryList;
  try {
    entries = performance.getEntriesByName(url, 'resource') ?? [];
  } catch {
    return undefined;
  }
  const entry = entries[entries.length - 1] as PerformanceResourceTiming | undefined;
  if (!entry) return undefined;
  const dnsMs = entry.domainLookupEnd > 0 ? entry.domainLookupEnd - entry.domainLookupStart : undefined;
  const connectMs = entry.connectEnd > 0 ? entry.connectEnd - entry.connectStart : undefined;
  const tlsMs = entry.secureConnectionStart > 0
    ? entry.connectEnd - entry.secureConnectionStart
    : undefined;
  const waitMs = entry.responseStart > 0 ? entry.responseStart - entry.requestStart : undefined;
  const downloadMs = entry.responseEnd > 0 ? entry.responseEnd - entry.responseStart : undefined;
  // Sanity: any single number above the observed wall-clock is a sign
  // Performance API entries are incomplete — drop them so the drawer
  // doesn't show obviously-wrong values.
  const clamp = (n: number | undefined): number | undefined =>
    n === undefined || !Number.isFinite(n) || n < 0 || n > totalMs * 2 ? undefined : n;
  return {
    dnsMs: clamp(dnsMs),
    connectMs: clamp(connectMs),
    tlsMs: clamp(tlsMs),
    waitMs: clamp(waitMs),
    downloadMs: clamp(downloadMs),
  };
}

export async function executeRequest(config: TestConfig, vars: Record<string, string>): Promise<RequestResult> {
  // Interpolation happens here (not in executeRawRequest) so the raw
  // executor stays a pure HTTP pass-through.
  const url = interpolate(config.url, vars);
  const res = await executeRawRequest({
    method: config.method,
    url,
    headers: Object.entries(buildHeaders(config, vars)),
    body: config.method === 'GET' || config.method === 'HEAD' ? undefined : interpolate(config.body, vars),
    timeout: config.timeout,
  });
  return {
    status: res.status,
    ms: res.ms,
    body: res.body,
    ok: res.ok,
    error: res.error,
    pass: false,
    ts: Date.now(),
    responseHeaders: Object.fromEntries(res.headers),
    finalUrl: res.finalUrl,
    bytes: res.bytes,
    timing: captureTiming(url, res.ms),
  };
}

export async function executeAndAssert(config: TestConfig, vars: Record<string, string>): Promise<RequestResult> {
  const result = await executeRequest(config, vars);
  const failures = evaluateAssertions(result, config.assertions);
  result.pass = failures.length === 0;
  result.failures = failures;
  return result;
}

/**
 * Single-shot connectivity probe used by the "Test Connection" button.
 *
 * Distinct from `executeRequest`:
 *  - Returns a narrow `ProbeResult` rather than the full RequestResult
 *  - Never writes to the metrics collector
 *  - Tags the failure with a coarse `errorKind` so the UI can colour and
 *    message each mode (timeout / network / DNS / CORS) consistently
 *  - Captures `finalUrl` so a redirect chain is visible without
 *    re-running the request
 *
 * Always uses the configured timeout. If no config is supplied the caller
 * must catch the resulting error.
 */
export async function probeRequest(config: TestConfig): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, config.timeout));
  const started = performance.now();
  const url = interpolate(config.url, Object.fromEntries(config.variables));
  try {
    const res = await fetch(url, {
      method: config.method,
      headers: buildHeaders(config, Object.fromEntries(config.variables)),
      body: config.method === 'GET' || config.method === 'HEAD' ? undefined : interpolate(config.body, Object.fromEntries(config.variables)),
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
    });
    const body = await res.text();
    const ms = performance.now() - started;
    return {
      ok: res.ok,
      status: res.status,
      ms,
      bytes: new TextEncoder().encode(body).length,
      error: '',
      errorKind: '',
      finalUrl: res.url,
    };
  } catch (e) {
    const err = e as Error;
    const ms = performance.now() - started;
    return {
      ok: false,
      status: 0,
      ms,
      bytes: 0,
      error: err.message || String(err),
      errorKind: classifyError(e),
      finalUrl: url,
    };
  } finally {
    clearTimeout(timer);
  }
}