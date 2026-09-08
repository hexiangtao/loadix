/** Pure helper functions for the load-testing engine. No DOM / chrome API dependencies. */

import type { Assertion, RequestResult, TestConfig } from '../shared/types';
import { queryJsonPath } from './jsonpath';

/** Replace `{{name}}` placeholders with values from the variables map. */
export function interpolate(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
}

/** Compute the p-th percentile (0-100) of a numeric sample. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
  return sorted[idx] ?? 0;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Evaluate all assertions against a single request result. */
export function assertionsPass(result: Omit<RequestResult, 'pass' | 'ts'>, assertions: Assertion[]): boolean {
  return evaluateAssertions(result, assertions).length === 0;
}

/**
 * Return the list of assertions that failed for a given request result.
 *
 * `jsonpath` asserts that a JSONPath expression matches at least one
 * non-null value in the parsed body. `header` asserts a response header:
 * `Name` alone checks presence, `Name:value` checks the exact value.
 */
export function evaluateAssertions(result: Omit<RequestResult, 'pass' | 'ts'>, assertions: Assertion[]): Assertion[] {
  const failures: Assertion[] = [];
  for (const a of assertions) {
    if (a.type === 'status' && result.status !== Number(a.value)) failures.push(a);
    else if (a.type === 'latency' && result.ms > Number(a.value)) failures.push(a);
    else if (a.type === 'contains' && !result.body.includes(a.value)) failures.push(a);
    else if (a.type === 'jsonpath') {
      let parsed: unknown = null;
      try {
        parsed = result.body.trim() ? JSON.parse(result.body) : null;
      } catch {
        parsed = null;
      }
      if (queryJsonPath(parsed, a.value).length === 0) failures.push(a);
    } else if (a.type === 'header') {
      const [name, expected] = splitHeaderAssertion(a.value);
      const headers = result.responseHeaders ?? {};
      const found = Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase());
      if (!found) failures.push(a);
      else if (expected !== undefined && found[1].trim() !== expected.trim()) failures.push(a);
    }
  }
  return failures;
}

/** `Content-Type:application/json` → [name, expected]; bare name → [name, undefined]. */
function splitHeaderAssertion(value: string): [string, string | undefined] {
  const idx = value.indexOf(':');
  if (idx === -1) return [value.trim(), undefined];
  return [value.slice(0, idx).trim(), value.slice(idx + 1).trim()];
}

/** Build the per-request headers, applying variable interpolation. */
export function buildHeaders(config: TestConfig, vars: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of config.headers) {
    headers[interpolate(key, vars)] = interpolate(value, vars);
  }
  if (config.method !== 'GET' && config.method !== 'HEAD') {
    headers['Content-Type'] = config.contentType;
  }
  return headers;
}
