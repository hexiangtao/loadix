/** Engine host for the Chrome extension: talks to the background service worker over a Port. */

import type { EngineHost } from '@/engine/engine-host';
import { probeRequest, type ProbeResult } from '@/engine/runner';
import type { EngineCommand, EngineEvent, EngineState, MetricsSnapshot, TestConfig } from '@/shared/types';

const PORT_NAME = 'engine';

export class ChromeEngineHost implements EngineHost {
  private port: chrome.runtime.Port | null = null;

  connect(onMetrics: (m: MetricsSnapshot) => void, onState: (s: EngineState, msg?: string) => void): void {
    if (this.port) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;
    this.port = chrome.runtime.connect({ name: PORT_NAME });
    this.port.onMessage.addListener((event: EngineEvent) => {
      if (event.type === 'METRICS') onMetrics(event.metrics);
      if (event.type === 'STATE') onState(event.state, event.message);
    });
    this.port.onDisconnect.addListener(() => {
      this.port = null;
    });
    this.send({ type: 'GET_STATE' });
  }

  start(config: TestConfig): void {
    this.send({ type: 'START', config });
  }

  stop(): void {
    this.send({ type: 'STOP' });
  }

  probe(config: TestConfig): Promise<ProbeResult> {
    // The Chrome extension runs requests in the SW where `host_permissions:
    // <all_urls>` exempts them from CORS. For a probe we can fire the fetch
    // right here in the dashboard page — same-origin requests get the same
    // CORS treatment as any other tab, so a quick probe is still a useful
    // sanity check even before the user starts a real run.
    return probeRequest(config);
  }

  private send(command: EngineCommand): void {
    this.port?.postMessage(command);
  }
}
