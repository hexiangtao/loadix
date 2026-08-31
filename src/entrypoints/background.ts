/**
 * Background service worker: hosts the LoadEngine + the capture pipeline.
 *
 * Running requests here (instead of the dashboard page) gives two benefits:
 *  1. Extension pages with host_permissions are exempt from CORS for
 *     authorized hosts, so far more APIs can be tested.
 *  2. The test keeps running when the dashboard tab is closed or refreshed;
 *     the UI re-syncs via the port when it comes back.
 *
 * Capture pipeline (see src/shared/capture.ts):
 *   1. The dashboard posts a CAPTURE_REQUEST (visible / fullpage / selection /
 *      element) to this SW.
 *   2. The SW calls `chrome.tabs.captureVisibleTab` for the relevant tab, or
 *      injects the area-selector content script to ask the user to pick.
 *   3. The SW crops / stitches the bitmap and posts a CAPTURE_RESULT back to
 *      the dashboard so the user can preview, copy, or download.
 */

import { defineBackground } from 'wxt/sandbox';
import { LoadEngine } from '@/engine/load-engine';
import type { EngineCommand, EngineEvent, EngineState, MetricsSnapshot } from '@/shared/types';
import type { CaptureRequest, CaptureResult, PickedElement, PickedRegion } from '@/shared/capture';

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

/* ------------------------------------------------------------------ */
/* Capture pipeline                                                    */
/* ------------------------------------------------------------------ */

const PICK_TIMEOUT_MS = 60_000;
const CONTENT_SCRIPT_ID = 'area-selector';

interface PendingPick {
  resolve: (msg: PickedRegion | PickedElement) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingPicks = new Map<number, PendingPick>();

function watchPicksForTab(tabId: number, onResolve: PendingPick['resolve'], onReject: PendingPick['reject']) {
  const timer = setTimeout(() => {
    pendingPicks.delete(tabId);
    onReject(new Error('Selection timed out'));
  }, PICK_TIMEOUT_MS);
  pendingPicks.set(tabId, { resolve: onResolve, reject: onReject, timer });
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    // executeScript is idempotent-ish: it always re-injects, but injecting the
    // same file is cheap and the script self-deduplicates by host id.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_ID],
    });
  } catch (e) {
    // Chrome refuses to inject into chrome:// pages, the Web Store itself,
    // and PDF viewers. Surface a friendly error.
    throw new Error(
      'This page does not allow content scripts (chrome://, the Web Store, or a PDF). Try a regular http(s) page.',
    );
  }
}

async function queryActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) throw new Error('No active tab');
  return tab;
}

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'capture';
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function dataUrlToBlobSize(dataUrl: string): number {
  // base64 length × 3/4 ≈ decoded size.
  const i = dataUrl.indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

async function captureTab(_tabId: number, format: 'png' | 'jpeg' = 'png'): Promise<{ dataUrl: string; width: number; height: number }> {
  // In MV3 the no-arg overload returns a promise; we don't need a windowId
  // because captureVisibleTab defaults to the current window.
  const dataUrl = await chrome.tabs.captureVisibleTab({ format });
  const img = await loadImage(dataUrl);
  return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode captured bitmap'));
    img.src = src;
  });
}

function cropDataUrl(
  dataUrl: string,
  crop: { x: number; y: number; width: number; height: number },
  dpr: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return loadImage(dataUrl).then((img) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(crop.width * dpr));
    c.height = Math.max(1, Math.round(crop.height * dpr));
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.drawImage(
      img,
      Math.round(crop.x * dpr),
      Math.round(crop.y * dpr),
      Math.round(crop.width * dpr),
      Math.round(crop.height * dpr),
      0, 0, c.width, c.height,
    );
    return { dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height };
  });
}

async function pickRegionInTab(tabId: number): Promise<PickedRegion> {
  await ensureContentScript(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'PICK_REGION' });
  return new Promise<PickedRegion>((resolve, reject) => {
    watchPicksForTab(tabId, (msg) => {
      if (msg.type !== 'PICKED_REGION') return reject(new Error('Unexpected picker reply'));
      resolve(msg);
    }, reject);
  });
}

async function pickElementInTab(tabId: number): Promise<PickedElement> {
  await ensureContentScript(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'PICK_ELEMENT' });
  return new Promise<PickedElement>((resolve, reject) => {
    watchPicksForTab(tabId, (msg) => {
      if (msg.type !== 'PICKED_ELEMENT') return reject(new Error('Unexpected picker reply'));
      resolve(msg);
    }, reject);
  });
}

/**
 * Capture the full scrollable page by stitching together several
 * captureVisibleTab snapshots while scrolling. Works for any same-origin page;
 * cross-origin iframes may show as empty.
 */
async function captureFullPage(tabId: number, origin: string): Promise<{ dataUrl: string; width: number; height: number }> {
  // Get the page's full dimensions from the content side.
  await ensureContentScript(tabId);
  const dims = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      vw: window.innerWidth,
      vh: window.innerHeight,
      dpr: window.devicePixelRatio,
    }),
  });
  const m = dims[0]?.result as { sw: number; sh: number; vw: number; vh: number; dpr: number } | undefined;
  if (!m) throw new Error('Failed to read page dimensions');
  const { sw, sh, vw, vh, dpr } = m;

  // Save original scroll position so we can restore it.
  const orig = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ x: window.scrollX, y: window.scrollY }),
  });
  const origPos = (orig[0]?.result as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };

  try {
    const canvas = new OffscreenCanvas(Math.round(sw * dpr), Math.round(sh * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D unavailable');
    // Fill with the page background (best-effort; we use #ffffff so transparent
    // areas are visible in the result).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cols = Math.ceil(sw / vw);
    const rows = Math.ceil(sh / vh);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * vw;
        const y = r * vh;
        // Scroll to the tile's top-left.
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (sx: number, sy: number) => {
            window.scrollTo(sx, sy);
          },
          args: [x, y],
        });
        // Give the browser a tick to paint the new viewport.
        await new Promise((res) => setTimeout(res, 60));
        const tile = await chrome.tabs.captureVisibleTab({ format: 'png' });
        const img = await loadImage(tile);
        ctx.drawImage(img, x * dpr, y * dpr, img.naturalWidth, img.naturalHeight);
      }
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, width: canvas.width, height: canvas.height };
  } finally {
    // Restore the original scroll position so the user isn't left at the bottom.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (sx: number, sy: number) => window.scrollTo(sx, sy),
        args: [origPos.x, origPos.y],
      });
    } catch {
      /* tab might have been closed; ignore */
    }
    void origin; // referenced for symmetry
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Failed to read blob'));
    r.readAsDataURL(blob);
  });
}

async function runCapture(req: CaptureRequest): Promise<CaptureResult> {
  const filename = `${safeFilename(req.filename || 'capture')}-${timestamp()}.png`;
  try {
    const tab = await queryActiveTab();
    if (tab.id == null) throw new Error('Active tab has no id');
    const tabId = tab.id;
    const origin = (() => {
      try { return new URL(tab.url ?? '').hostname; } catch { return 'tab'; }
    })();

    switch (req.mode) {
      case 'visible': {
        const { dataUrl, width, height } = await captureTab(tabId);
        return ok(filename, dataUrl, width, height);
      }
      case 'fullpage': {
        const { dataUrl, width, height } = await captureFullPage(tabId, origin);
        return ok(filename, dataUrl, width, height);
      }
      case 'selection': {
        const region = await pickRegionInTab(tabId);
        const { dataUrl } = await captureTab(tabId);
        const cropped = await cropDataUrl(dataUrl, region, region.devicePixelRatio);
        return ok(filename, cropped.dataUrl, cropped.width, cropped.height);
      }
      case 'element': {
        if (req.selector) {
          // Direct selector — skip the picker UI.
          const elInfo = await chrome.scripting.executeScript({
            target: { tabId },
            func: (sel: string) => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return {
                x: r.left, y: r.top, width: r.width, height: r.height,
                dpr: window.devicePixelRatio,
                sx: window.scrollX, sy: window.scrollY,
              };
            },
            args: [req.selector],
          });
          const info = elInfo[0]?.result as
            | { x: number; y: number; width: number; height: number; dpr: number; sx: number; sy: number }
            | null
            | undefined;
          if (!info) throw new Error(`No element matches "${req.selector}"`);
          // Scroll the element to the top-left so it is fully inside the visible viewport.
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (sx: number, sy: number) => window.scrollTo(sx, sy),
            args: [info.sx + info.x, info.sy + info.y],
          });
          await new Promise((r) => setTimeout(r, 60));
          const tab2 = await captureTab(tabId);
          const cropped = await cropDataUrl(
            tab2.dataUrl,
            { x: 0, y: 0, width: info.width, height: info.height },
            info.dpr,
          );
          return ok(filename, cropped.dataUrl, cropped.width, cropped.height);
        }
        const picked = await pickElementInTab(tabId);
        const tab2 = await captureTab(tabId);
        const cropped = await cropDataUrl(
          tab2.dataUrl,
          { x: picked.rect.x, y: picked.rect.y, width: picked.rect.width, height: picked.rect.height },
          picked.devicePixelRatio,
        );
        return ok(filename, cropped.dataUrl, cropped.width, cropped.height);
      }
    }
  } catch (e) {
    return {
      type: 'CAPTURE_RESULT',
      ok: false,
      filename,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function ok(filename: string, dataUrl: string, width: number, height: number): CaptureResult {
  return {
    type: 'CAPTURE_RESULT',
    ok: true,
    filename,
    dataUrl,
    width,
    height,
    bytes: dataUrlToBlobSize(dataUrl),
  };
}

/* ------------------------------------------------------------------ */
/* Wire-up                                                              */
/* ------------------------------------------------------------------ */

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

  // Engine port: dashboard ↔ service worker.
  chrome.runtime.onConnect.addListener((port) => {
    host.addPort(port);
    port.onMessage.addListener((msg: EngineCommand) => host.handleCommand(msg));
  });

  // Capture: dashboard requests a snapshot, we respond with a CAPTURE_RESULT.
  chrome.runtime.onMessage.addListener((msg: CaptureRequest, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || msg.type !== 'CAPTURE_REQUEST') return false;
    runCapture(msg).then(sendResponse);
    return true; // tell Chrome we'll respond asynchronously
  });

  // Content-script replies routed back to the right tab.
  chrome.runtime.onMessage.addListener((raw, sender) => {
    if (!sender.tab?.id) return;
    const msg = raw as PickedRegion | PickedElement | { type: string } | undefined;
    if (!msg) return;
    if (msg.type !== 'PICKED_REGION' && msg.type !== 'PICKED_ELEMENT' && msg.type !== 'PICK_CANCELLED') return;
    const pending = pendingPicks.get(sender.tab.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingPicks.delete(sender.tab.id);
    if (msg.type === 'PICK_CANCELLED') {
      pending.reject(new Error('Selection cancelled'));
    } else {
      // The pending.resolve is typed as (PickedRegion | PickedElement) — both
      // PICKED_* values satisfy that union, so this assignment is sound.
      pending.resolve(msg as PickedRegion | PickedElement);
    }
  });

  // Clean up pending picks when a tab is closed.
  chrome.tabs.onRemoved.addListener((tabId) => {
    const pending = pendingPicks.get(tabId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingPicks.delete(tabId);
      pending.reject(new Error('Tab closed during selection'));
    }
  });

  // Keyboard shortcut: Alt+Shift+S opens the area-selector on the active tab.
  // We don't auto-download — the dashboard popover handles that, and the user
  // has to opt in to a download. Fall back to captureVisibleTab so the
  // shortcut "just works" even when the dashboard isn't open.
  chrome.commands?.onCommand.addListener(async (command) => {
    if (command !== 'capture-region') return;
    try {
      const tab = await queryActiveTab();
      if (tab.id == null) return;
      const region = await pickRegionInTab(tab.id);
      const shot = await captureTab(tab.id);
      const cropped = await cropDataUrl(
        shot.dataUrl,
        { x: region.x, y: region.y, width: region.width, height: region.height },
        region.devicePixelRatio,
      );
      const a = document.createElement('a');
      a.href = cropped.dataUrl;
      a.download = `loadix-region-${timestamp()}.png`;
      // The download attribute is honoured even when the data URL is in-memory.
      a.click();
    } catch (e) {
      console.warn('[loadix] capture-region failed', e);
    }
  });
});
