/** Pure helper functions for the load-testing engine. No DOM / chrome API dependencies. */

import type { Assertion, RequestResult, TestConfig } from '../shared/types';

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

/** Return the list of assertions that failed for a given request result. */
export function evaluateAssertions(result: Omit<RequestResult, 'pass' | 'ts'>, assertions: Assertion[]): Assertion[] {
  const failures: Assertion[] = [];
  for (const a of assertions) {
    if (a.type === 'status' && result.status !== Number(a.value)) failures.push(a);
    else if (a.type === 'latency' && result.ms > Number(a.value)) failures.push(a);
    else if (a.type === 'contains' && !result.body.includes(a.value)) failures.push(a);
  }
  return failures;
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

/**
 * Compute the launch delay (ms) for a virtual user so that the ramp-up
 * period spreads user starts evenly across `ramp` seconds.
 */
export function rampUpDelay(userIndex: number, totalUsers: number, rampSeconds: number): number {
  if (rampSeconds <= 0 || totalUsers <= 1) return 0;
  return (userIndex / totalUsers) * rampSeconds * 1000;
}

/**
 * Global RPS scheduler: given the target interval and the number of slots
 * already consumed, return the timestamp (ms, performance clock) at which
 * the next request should be launched, or null if the caller should wait.
 */
export class RpsScheduler {
  private nextAt: number;
  private readonly interval: number;

  constructor(rps: number, now: number) {
    this.interval = rps > 0 ? 1000 / rps : 0;
    this.nextAt = now;
  }

  /** Returns the wait time in ms before the next launch (0 = launch now). */
  acquire(now: number): number {
    if (this.interval === 0) return 0;
    const wait = this.nextAt - now;
    this.nextAt = Math.max(this.nextAt + this.interval, now + this.interval);
    return Math.max(0, wait);
  }
}
