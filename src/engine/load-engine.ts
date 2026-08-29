/**
 * Load-testing orchestrator: manages virtual users, RPS pacing, ramp-up,
 * duration and abort. Framework-agnostic — the host (background service
 * worker) wires `onMetrics` / `onState` callbacks to messaging.
 */

import type { EngineState, MetricsSnapshot, TestConfig } from '../shared/types';
import { RpsScheduler, rampUpDelay } from './core';
import { MetricsCollector } from './metrics';
import { executeAndAssert } from './runner';

const METRICS_INTERVAL_MS = 500;

export class LoadEngine {
  private config: TestConfig | null = null;
  private collector = new MetricsCollector();
  private abortFlag = false;
  private running = false;
  private startedAt = 0;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private onMetrics: (metrics: MetricsSnapshot) => void,
    private onState: (state: EngineState, message?: string) => void,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async start(config: TestConfig): Promise<void> {
    if (this.running) return;
    this.config = config;
    this.abortFlag = false;
    this.running = true;
    this.startedAt = Date.now();
    this.collector.reset(this.startedAt);
    this.onState('running');

    this.metricsTimer = setInterval(() => {
      this.onMetrics(this.collector.snapshot(Date.now()));
    }, METRICS_INTERVAL_MS);

    const deadline = Date.now() + config.duration * 1000;
    const workers = Math.max(1, Math.min(config.users, 100));
    const scheduler = new RpsScheduler(config.rps, performance.now());

    const worker = async (index: number): Promise<void> => {
      const vars = Object.fromEntries(config.variables);
      const delay = rampUpDelay(index, workers, config.ramp);
      if (delay > 0) await sleep(delay);
      while (!this.abortFlag && Date.now() < deadline) {
        const wait = scheduler.acquire(performance.now());
        if (wait > 0) await sleep(wait);
        if (this.abortFlag || Date.now() >= deadline) break;
        const result = await executeAndAssert(config, vars);
        this.collector.add(result);
      }
    };

    await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));

    clearInterval(this.metricsTimer!);
    this.metricsTimer = null;
    this.running = false;
    const finalState: EngineState = this.abortFlag ? 'aborted' : 'finished';
    this.onState(finalState);
    this.onMetrics(this.collector.snapshot(Date.now()));
  }

  stop(): void {
    this.abortFlag = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
