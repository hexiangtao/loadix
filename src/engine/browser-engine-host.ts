/** Engine host for the web app: runs the LoadEngine directly in-page (no Chrome API). */

import type { EngineHost } from '@/engine/engine-host';
import { LoadEngine } from '@/engine/load-engine';
import type { EngineState, MetricsSnapshot, TestConfig } from '@/shared/types';

export class BrowserEngineHost implements EngineHost {
  private engine: LoadEngine | null = null;

  connect(onMetrics: (m: MetricsSnapshot) => void, onState: (s: EngineState, msg?: string) => void): void {
    if (this.engine) return;
    this.engine = new LoadEngine(onMetrics, onState);
  }

  start(config: TestConfig): void {
    void this.engine?.start(config);
  }

  stop(): void {
    this.engine?.stop();
  }
}
