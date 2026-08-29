/** Messaging client: talks to the background engine over a long-lived Port. */

import type { EngineCommand, EngineEvent, EngineState, MetricsSnapshot, TestConfig } from '@/shared/types';

const PORT_NAME = 'engine';

export class EngineClient {
  private port: chrome.runtime.Port | null = null;
  private pendingState: { state: EngineState; message?: string } | null = null;

  constructor(
    private onMetrics: (metrics: MetricsSnapshot) => void,
    private onState: (state: EngineState, message?: string) => void,
  ) {}

  connect(): void {
    if (this.port) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;
    this.port = chrome.runtime.connect({ name: PORT_NAME });
    this.port.onMessage.addListener((event: EngineEvent) => {
      if (event.type === 'METRICS') this.onMetrics(event.metrics);
      if (event.type === 'STATE') this.onState(event.state, event.message);
    });
    this.port.onDisconnect.addListener(() => {
      this.port = null;
    });
    // Ask for the current engine state so a refreshed UI can re-sync.
    this.send({ type: 'GET_STATE' });
  }

  start(config: TestConfig): void {
    this.send({ type: 'START', config });
  }

  stop(): void {
    this.send({ type: 'STOP' });
  }

  private send(command: EngineCommand): void {
    this.port?.postMessage(command);
  }
}
