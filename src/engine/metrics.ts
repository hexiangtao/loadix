/** Aggregates raw request results into live metrics snapshots. */

import type { MetricsSnapshot, RequestResult } from '../shared/types';
import { average, percentile } from './core';

const RECENT_LIMIT = 30;
const LATENCY_SERIES_LIMIT = 100;
const SLOWEST_LIMIT = 10;

export class MetricsCollector {
  private results: RequestResult[] = [];
  private latencies: number[] = [];
  private statusCount: Record<string, number> = {};
  private failureCount: Record<string, number> = {};
  private startedAt = 0;

  reset(startedAt: number): void {
    this.results = [];
    this.latencies = [];
    this.statusCount = {};
    this.failureCount = {};
    this.startedAt = startedAt;
  }

  add(result: RequestResult): void {
    this.results.push(result);
    this.latencies.push(result.ms);
    const key = result.status || result.error || 'ERROR';
    this.statusCount[key] = (this.statusCount[key] ?? 0) + 1;
    for (const f of result.failures ?? []) {
      const fkey = `${f.type}:${f.value}`;
      this.failureCount[fkey] = (this.failureCount[fkey] ?? 0) + 1;
    }
  }

  get all(): readonly RequestResult[] {
    return this.results;
  }

  snapshot(now: number): MetricsSnapshot {
    const elapsed = Math.max(0.1, (now - this.startedAt) / 1000);
    const success = this.results.filter((r) => r.pass).length;
    const slowest = [...this.results].sort((a, b) => b.ms - a.ms).slice(0, SLOWEST_LIMIT);
    return {
      requests: this.results.length,
      success,
      errors: this.results.length - success,
      rps: this.results.length / elapsed,
      avg: average(this.latencies),
      p95: percentile(this.latencies, 95),
      p99: percentile(this.latencies, 99),
      successRate: (success / (this.results.length || 1)) * 100,
      statusBreakdown: { ...this.statusCount },
      recent: this.results.slice(-RECENT_LIMIT).reverse(),
      throughput: this.throughputPerSecond(),
      latencySeries: this.latencies.slice(-LATENCY_SERIES_LIMIT),
      assertionFailures: { ...this.failureCount },
      slowest,
    };
  }

  /** Requests per second, bucketed by wall-clock second since start. */
  private throughputPerSecond(): number[] {
    const buckets: number[] = [];
    for (const r of this.results) {
      const sec = Math.floor((r.ts - this.startedAt) / 1000);
      buckets[sec] = (buckets[sec] ?? 0) + 1;
    }
    return buckets.map((v) => v ?? 0);
  }
}
