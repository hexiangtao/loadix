/** Aggregates raw request results into live metrics snapshots.
 *
 * Memory-conscious for long runs (soak tests):
 *  - `recentResults` / `recentLatencies` are bounded ring buffers (recent only).
 *  - Latency percentiles use reservoir sampling (unbiased, bounded memory).
 *  - Counters (requests/success/status/failures) are incremental ints.
 *  - Slowest is a fixed-size top-N.
 *  - Throughput is bucketed per second, bounded to a rolling window.
 */

import type { ErrorGroup, MetricsSnapshot, RequestResult } from '../shared/types';
import { average, percentile } from './core';

const RECENT_LIMIT = 30;
const LATENCY_SERIES_LIMIT = 100;
const SLOWEST_LIMIT = 10;
const RESERVOIR_SIZE = 20000;
const THROUGHPUT_WINDOW = 3600; // seconds
const ERROR_GROUPS_LIMIT = 8;

export class MetricsCollector {
  private recentResults: RequestResult[] = [];
  private recentLatencies: number[] = [];
  private latencyReservoir: number[] = [];
  private reservoirCount = 0;
  private slowest: RequestResult[] = [];
  private throughput: number[] = [];
  private statusCount: Record<string, number> = {};
  private failureCount: Record<string, number> = {};
  /** message (normalised) → { count, sample }. Only tracks transport-level
   *  failures (status === 0 with a non-empty error) — assertion failures
   *  have their own panel and would muddy this view. */
  private errorGroups = new Map<string, ErrorGroup>();
  private totalRequests = 0;
  private totalSuccess = 0;
  private maxLatency = 0;
  private startedAt = 0;

  reset(startedAt: number): void {
    this.recentResults = [];
    this.recentLatencies = [];
    this.latencyReservoir = [];
    this.reservoirCount = 0;
    this.slowest = [];
    this.throughput = [];
    this.statusCount = {};
    this.failureCount = {};
    this.errorGroups.clear();
    this.totalRequests = 0;
    this.totalSuccess = 0;
    this.maxLatency = 0;
    this.startedAt = startedAt;
  }

  add(result: RequestResult): void {
    this.totalRequests++;
    if (result.pass) this.totalSuccess++;
    if (result.ms > this.maxLatency) this.maxLatency = result.ms;

    // Recent results (bounded ring buffer).
    this.recentResults.push(result);
    if (this.recentResults.length > RECENT_LIMIT * 4) this.recentResults.shift();

    // Recent latencies for the latency chart (time-ordered, bounded).
    this.recentLatencies.push(result.ms);
    if (this.recentLatencies.length > LATENCY_SERIES_LIMIT) this.recentLatencies.shift();

    // Latency reservoir sampling (unbiased percentile estimate, bounded).
    this.reservoirCount++;
    if (this.latencyReservoir.length < RESERVOIR_SIZE) {
      this.latencyReservoir.push(result.ms);
    } else {
      const idx = Math.floor(Math.random() * this.reservoirCount);
      if (idx < RESERVOIR_SIZE) this.latencyReservoir[idx] = result.ms;
    }

    // Slowest top-N.
    this.insertSlowest(result);
    // Error-message grouping: only when the request failed before getting
    // an HTTP status (network error, abort, CORS, DNS, …). Assertion failures
    // surface separately — keeping them out of this view means an API that
    // returns 200 but trips `body contains "ok"` doesn't pollute the network
    // error panel.
    if (!result.status && result.error) {
      const normalised = normaliseError(result.error);
      const existing = this.errorGroups.get(normalised);
      if (existing) {
        existing.count++;
        existing.sample = result;
      } else {
        this.errorGroups.set(normalised, { message: normalised, count: 1, sample: result });
      }
    }

    // 
    // Status breakdown.
    const key = result.status || result.error || 'ERROR';
    this.statusCount[key] = (this.statusCount[key] ?? 0) + 1;

    // Assertion failures.
    for (const f of result.failures ?? []) {
      const fkey = `${f.type}:${f.value}`;
      this.failureCount[fkey] = (this.failureCount[fkey] ?? 0) + 1;
    }

    // Throughput bucket (per second since start).
    const sec = Math.floor((result.ts - this.startedAt) / 1000);
    this.throughput[sec] = (this.throughput[sec] ?? 0) + 1;
    if (this.throughput.length > THROUGHPUT_WINDOW) {
      this.throughput = this.throughput.slice(-THROUGHPUT_WINDOW);
    }
  }

  get all(): readonly RequestResult[] {
    return this.recentResults;
  }

  snapshot(now: number): MetricsSnapshot {
    const elapsed = Math.max(0.1, (now - this.startedAt) / 1000);
    return {
      requests: this.totalRequests,
      success: this.totalSuccess,
      errors: this.totalRequests - this.totalSuccess,
      rps: this.totalRequests / elapsed,
      avg: average(this.latencyReservoir),
      p50: percentile(this.latencyReservoir, 50),
      p90: percentile(this.latencyReservoir, 90),
      p95: percentile(this.latencyReservoir, 95),
      p99: percentile(this.latencyReservoir, 99),
      max: this.maxLatency,
      successRate: (this.totalSuccess / (this.totalRequests || 1)) * 100,
      statusBreakdown: { ...this.statusCount },
      recent: this.recentResults.slice(-RECENT_LIMIT).reverse(),
      throughput: this.fillThroughput(),
      latencySeries: [...this.recentLatencies],
      assertionFailures: { ...this.failureCount },
      slowest: [...this.slowest],
      errorGroups: [...this.errorGroups.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, ERROR_GROUPS_LIMIT),
    };
  }

  private insertSlowest(result: RequestResult): void {
    if (this.slowest.length < SLOWEST_LIMIT) {
      this.slowest.push(result);
      this.slowest.sort((a, b) => b.ms - a.ms);
      return;
    }
    const last = this.slowest[this.slowest.length - 1];
    if (last && result.ms > last.ms) {
      this.slowest[this.slowest.length - 1] = result;
      this.slowest.sort((a, b) => b.ms - a.ms);
    }
  }

  /** Fill sparse throughput buckets with zeros for the chart. */
  private fillThroughput(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.throughput.length; i++) {
      out.push(this.throughput[i] ?? 0);
    }
    return out;
  }
}

/**
 * Normalise an error message so identical failures from different VUs
 * collapse into one bucket.
 *
 * Strategy: strip volatile fragments that change between occurrences of an
 * otherwise-identical error — stack-trace line/column numbers, port numbers
 * in fetch URLs, IP addresses, timestamps, and trailing punctuation. The
 * result is the first line, trimmed, length-capped to keep the UI tidy.
 *
 * Examples:
 *   "TypeError: Failed to fetch\n    at fetch (url:1:1)" → "TypeError: Failed to fetch"
 *   "NetworkError when attempting to fetch resource."     → "NetworkError when attempting to fetch resource."
 *   "TIMEOUT"                                             → "TIMEOUT"  (engine-supplied sentinel)
 */
export function normaliseError(raw: string): string {
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? raw;
  const stripped = firstLine
    .replace(/\s+at\s+.*$/, '')            // V8-style stack frames
    .replace(/:\d+:\d+/g, '')              // "url:1:1" / ":23:5"
    .replace(/https?:\/\/\S+/g, '<url>')   // URLs in messages (CORS / DNS)
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>') // IPv4
    .replace(/\b\d+\b/g, (m) => (m.length > 4 ? '<n>' : m)) // large ids, keep short ones
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。，；;]+$/, '');
  const capped = stripped.length > 140 ? `${stripped.slice(0, 137)}…` : stripped;
  return capped || raw.trim() || 'Unknown error';
}
