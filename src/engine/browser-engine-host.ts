/** Engine host for the web app: runs the LoadEngine directly in-page (no Chrome API). */

import type { EngineHost } from '@/engine/engine-host';
import { LoadEngine } from '@/engine/load-engine';
import { probeRequest, type ProbeResult } from '@/engine/runner';
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

  probe(config: TestConfig): Promise<ProbeResult> {
    // The web host runs the engine in-page; even if no run has been
    // started yet, we can still probe the URL with the supplied config.
    if (this.engine) return this.engine.probe(config);
    return probeRequest(config);
  }
}
