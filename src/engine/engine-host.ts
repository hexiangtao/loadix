/** Platform-agnostic interface for the load-testing engine host. */

import type { EngineState, MetricsSnapshot, TestConfig } from '@/shared/types';

/**
 * Both the Chrome extension (background service worker) and the web app
 * (in-page memory) implement this interface. The UI only knows about this
 * contract, so the same dashboard code runs in both environments.
 */
export interface EngineHost {
  /** Attach metric/state listeners and initialize the host. */
  connect(onMetrics: (m: MetricsSnapshot) => void, onState: (s: EngineState, msg?: string) => void): void;
  start(config: TestConfig): void;
  stop(): void;
}
