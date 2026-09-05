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

/**
 * Capture response headers into a plain object. Multi-value headers (e.g.
 * Set-Cookie) are joined with `, ` — enough for inspection in the drawer,
 * not a faithful wire-format replay.
 */
function captureResponseHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    const prev = out[key];
    out[key] = prev ? `${prev}, ${value}` : value;
  });
  return out;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout);
  const started = performance.now();
  // Clear any stale entries from a previous request to the same URL —
  // Performance API keeps them around and `getEntriesByName` would return
  // all of them, which we'd then confuse for one request.
  const url = interpolate(config.url, vars);
  try {
    // Wipe the previous run's entries — getEntriesByName would otherwise
    // return every historical entry matching the URL and we'd mis-attribute
    // them to the latest request.
    performance.clearResourceTimings();
  } catch {
    /* not supported everywhere; the clamp in captureTiming still guards
       against absurd numbers if stale entries slip through. */
  }

  try {
    const res = await fetch(url, {
      method: config.method,
      headers: buildHeaders(config, vars),
      body: config.method === 'GET' || config.method === 'HEAD' ? undefined : interpolate(config.body, vars),
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = await res.text();
    const ms = performance.now() - started;
    return {
      status: res.status,
      ms,
      body,
      ok: res.ok,
      error: '',
      pass: false,
      ts: Date.now(),
      responseHeaders: captureResponseHeaders(res),
      finalUrl: res.url,
      bytes: new TextEncoder().encode(body).length,
      timing: captureTiming(url, ms),
    };
  } catch (e) {
    const err = e as Error;
    const ms = performance.now() - started;
    return {
      status: 0,
      ms,
      body: '',
      ok: false,
      error: err.name === 'AbortError' ? 'TIMEOUT' : err.message,
      pass: false,
      ts: Date.now(),
      // Best-effort: if the request hit the network at all before failing,
      // surface whatever timing was captured.
      timing: captureTiming(url, ms),
    };
  } finally {
    clearTimeout(timer);
  }
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
    const err = e as Error & { cause?: unknown };
    const ms = performance.now() - started;
    const message = err.message || String(err);
    // Heuristic classification — the Fetch API doesn't expose a stable
    // error type, so we sniff the message. Each branch maps to a stable
    // UI colour/icon so users can diagnose at a glance.
    let errorKind: ProbeResult['errorKind'] = 'network';
    if (err.name === 'AbortError') errorKind = 'timeout';
    else if (/Failed to fetch|NetworkError|network/i.test(message)) errorKind = 'network';
    else if (/DNS|getaddrinfo|ENOTFOUND|hostname/i.test(message)) errorKind = 'dns';
    else if (/CORS|cors|Access-Control/i.test(message)) errorKind = 'cors';
    else if (/aborted/i.test(message)) errorKind = 'aborted';
    return {
      ok: false,
      status: 0,
      ms,
      bytes: 0,
      error: message,
      errorKind,
      finalUrl: url,
    };
  } finally {
    clearTimeout(timer);
  }
}
