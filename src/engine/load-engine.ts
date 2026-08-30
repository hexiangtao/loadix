/**
 * Load-testing orchestrator.
 *
 * Separates **concurrency** from **RPS**:
 *  - A control loop adjusts the number of in-flight requests to match the
 *    load model's concurrency target over time.
 *  - A token bucket paces request starts to the target RPS.
 *
 * Framework-agnostic — the host wires `onMetrics` / `onState` to messaging.
 */

import type { EngineState, MetricsSnapshot, TestConfig } from '../shared/types';
import type { LoadModel } from './load-model';
import { TokenBucket, targetConcurrency } from './load-model';
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

    const model: LoadModel = {
      kind: config.ramp > 0 ? 'ramp' : 'constant',
      users: Math.max(1, config.users),
      duration: config.duration,
      ramp: config.ramp,
      rps: config.rps,
    };

    await this.runLoop(model);

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    this.running = false;
    const finalState: EngineState = this.abortFlag ? 'aborted' : 'finished';
    this.onState(finalState);
    this.onMetrics(this.collector.snapshot(Date.now()));
  }

  stop(): void {
    this.abortFlag = true;
  }

  /**
   * Control loop: keeps the number of in-flight requests at the model's
   * concurrency target, paced by the token bucket.
   */
  private async runLoop(model: LoadModel): Promise<void> {
    const deadline = this.startedAt + model.duration * 1000;
    const vars = Object.fromEntries(this.config?.variables ?? []);
    const bucket = new TokenBucket(model.rps, performance.now());
    let inFlight = 0;

    const shouldStop = (): boolean => this.abortFlag || Date.now() >= deadline;

    while (!shouldStop()) {
      const elapsedSec = (Date.now() - this.startedAt) / 1000;
      const target = targetConcurrency(model, elapsedSec);

      // Scale up: start requests until we hit the concurrency target,
      // respecting the RPS token bucket.
      while (inFlight < target && !shouldStop()) {
        if (!bucket.take(performance.now())) break; // rate-limited; wait
        inFlight++;
        void this.runOne(vars).finally(() => {
          inFlight--;
        });
      }

      await sleep(10);
    }

    // Graceful drain: wait for in-flight requests to finish, with a cap.
    const drainDeadline = Date.now() + 5000;
    while (inFlight > 0 && Date.now() < drainDeadline) {
      await sleep(20);
    }
  }

  private async runOne(vars: Record<string, string>): Promise<void> {
    if (!this.config) return;
    const result = await executeAndAssert(this.config, vars);
    this.collector.add(result);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
