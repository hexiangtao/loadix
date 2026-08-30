/** Aggregates raw request results into live metrics snapshots.
 *
 * Memory-conscious for long runs (soak tests):
 *  - `recentResults` / `recentLatencies` are bounded ring buffers (recent only).
 *  - Latency percentiles use reservoir sampling (unbiased, bounded memory).
 *  - Counters (requests/success/status/failures) are incremental ints.
 *  - Slowest is a fixed-size top-N.
 *  - Throughput is bucketed per second, bounded to a rolling window.
 */

import type { MetricsSnapshot, RequestResult } from '../shared/types';
import { average, percentile } from './core';

const RECENT_LIMIT = 30;
const LATENCY_SERIES_LIMIT = 100;
const SLOWEST_LIMIT = 10;
const RESERVOIR_SIZE = 20000;
const THROUGHPUT_WINDOW = 3600; // seconds

export class MetricsCollector {
  private recentResults: RequestResult[] = [];
  private recentLatencies: number[] = [];
  private latencyReservoir: number[] = [];
  private reservoirCount = 0;
  private slowest: RequestResult[] = [];
  private throughput: number[] = [];
  private statusCount: Record<string, number> = {};
  private failureCount: Record<string, number> = {};
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
