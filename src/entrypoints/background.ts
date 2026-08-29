/**
 * Background service worker: hosts the LoadEngine.
 *
 * Running requests here (instead of the dashboard page) gives two benefits:
 *  1. Extension pages with host_permissions are exempt from CORS for
 *     authorized hosts, so far more APIs can be tested.
 *  2. The test keeps running when the dashboard tab is closed or refreshed;
 *     the UI re-syncs via the port when it comes back.
 */

import { defineBackground } from 'wxt/sandbox';
import { LoadEngine } from '@/engine/load-engine';
import type { EngineCommand, EngineEvent, EngineState, MetricsSnapshot } from '@/shared/types';

class EngineHost {
  private ports = new Set<chrome.runtime.Port>();
  private lastMetrics: MetricsSnapshot | null = null;
  private lastState: { state: EngineState; message?: string } = { state: 'idle' };
  private engine: LoadEngine;

  constructor() {
    this.engine = new LoadEngine(
      (metrics) => this.broadcast({ type: 'METRICS', metrics }),
      (state, message) => {
        this.lastState = { state, message };
        this.broadcast({ type: 'STATE', state, message });
      },
    );
  }

  handleCommand(command: EngineCommand): void {
    switch (command.type) {
      case 'START':
        void this.engine.start(command.config);
        break;
      case 'STOP':
        this.engine.stop();
        break;
      case 'GET_STATE':
        this.pushState();
        break;
    }
  }

  addPort(port: chrome.runtime.Port): void {
    this.ports.add(port);
    port.onDisconnect.addListener(() => this.ports.delete(port));
    // Re-sync a freshly connected (or refreshed) dashboard.
    port.postMessage({ type: 'STATE', ...this.lastState });
    if (this.lastMetrics) port.postMessage({ type: 'METRICS', metrics: this.lastMetrics });
  }

  pushState(): void {
    this.broadcast({ type: 'STATE', ...this.lastState });
  }

  private broadcast(event: EngineEvent): void {
    if (event.type === 'METRICS') this.lastMetrics = event.metrics;
    for (const port of this.ports) port.postMessage(event);
  }
}

const host = new EngineHost();

export default defineBackground(() => {
  // Open (or focus) the dashboard when the toolbar icon is clicked.
  chrome.action.onClicked.addListener(async () => {
    const url = chrome.runtime.getURL('/dashboard.html');
    const tabs = await chrome.tabs.query({ url });
    const existing = tabs[0];
    if (existing) {
      await chrome.tabs.update(existing.id ?? 0, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
  });

  chrome.runtime.onConnect.addListener((port) => {
    host.addPort(port);
    port.onMessage.addListener((msg: EngineCommand) => host.handleCommand(msg));
  });
});
