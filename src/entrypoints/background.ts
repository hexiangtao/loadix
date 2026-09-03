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
import type { CaptureRequest, CaptureResult, PickedElement, PickedRegion, PickerResult } from '@/shared/capture';

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
/** Path (relative to the extension root) of the compiled area-selector content
 *  script. WXT emits runtime-registered content scripts under
 *  content-scripts/<name>.js; keep in sync with web_accessible_resources. */
const AREA_SELECTOR_FILE = 'content-scripts/area-selector.js';

const EXTENSION_ORIGIN = (() => {
  try { return chrome.runtime.getURL(''); } catch { return ''; }
})();

interface PendingPick {
  resolve: (msg: PickedRegion | PickedElement) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingPicks = new Map<number, PendingPick>();

/** windowId → the last tab the user actually browsed in that window (i.e. any
 *  tab that is not the Loadix dashboard). Used so the dashboard's capture
 *  launcher screenshots the page the user was looking at, not Loadix itself. */
const lastBrowsedTab = new Map<number, number>();

function isLoadixUrl(url: string | undefined): boolean {
  return !!url && !!EXTENSION_ORIGIN && url.startsWith(EXTENSION_ORIGIN);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function watchPicksForTab(tabId: number, onResolve: PendingPick['resolve'], onReject: PendingPick['reject']) {
  const timer = setTimeout(() => {
    pendingPicks.delete(tabId);
    onReject(new Error('Selection timed out'));
  }, PICK_TIMEOUT_MS);
  pendingPicks.set(tabId, { resolve: onResolve, reject: onReject, timer });
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    // Re-injecting is cheap and the script self-deduplicates its message
    // listener (see area-selector.content.ts), so repeated calls are safe.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [AREA_SELECTOR_FILE],
    });
  } catch {
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

/**
 * Decide which tab a capture should run against. When the active tab is the
 * Loadix dashboard (or any extension page), fall back to the last real page
 * the user browsed in that window — that is the page a screenshot button is
 * expected to capture.
 */
async function resolveTargetTab(active?: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  const tab = active ?? (await queryActiveTab());
  if (tab.id != null && !isLoadixUrl(tab.url)) return tab;

  const candidates: Array<{ windowId: number; tabId: number }> = [];
  if (tab.windowId != null) {
    const rememberedId = lastBrowsedTab.get(tab.windowId);
    if (rememberedId != null) candidates.push({ windowId: tab.windowId, tabId: rememberedId });
  }
  for (const [windowId, tabId] of lastBrowsedTab) candidates.push({ windowId, tabId });

  for (const candidate of candidates) {
    try {
      const t = await chrome.tabs.get(candidate.tabId);
      if (t.id != null && !isLoadixUrl(t.url)) return t;
    } catch {
      lastBrowsedTab.delete(candidate.windowId);
    }
  }

  // Nothing browsed yet — capture the active tab anyway (self-capture), or
  // fail with guidance.
  if (tab.id != null) return tab;
  throw new Error('Open the web page you want to capture first, then retry.');
}

/** Bring a window to the front and make the tab active so captureVisibleTab
 *  reflects it, and give the compositor a frame to settle. */
async function focusTab(tab: chrome.tabs.Tab): Promise<void> {
  try {
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    if (tab.id != null) await chrome.tabs.update(tab.id, { active: true });
    await sleep(200);
  } catch {
    /* tab closed mid-flight; the caller will surface an error */
  }
}

/** Bring the caller's own tab (the dashboard) back to the front. */
async function focusSenderTab(sender: chrome.runtime.MessageSender | undefined): Promise<void> {
  const tab = sender?.tab;
  if (!tab) return;
  try {
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    if (tab.id != null) await chrome.tabs.update(tab.id, { active: true });
  } catch {
    /* the dashboard tab may have been closed; ignore */
  }
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

/** Decode a data URL without touching the DOM. The background is an MV3
 *  service worker: no <img>, no document, no FileReader. */
async function decodeDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const resp = await fetch(dataUrl);
  if (!resp.ok) throw new Error('Failed to decode captured bitmap');
  return createImageBitmap(await resp.blob());
}

/** Encode a blob as a PNG data URL (FileReader is unavailable in workers). */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/** Capture the *visible* area of the active tab of the given window (or the
 *  current window when omitted). */
async function captureActiveTab(windowId?: number): Promise<{ dataUrl: string; width: number; height: number }> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: 'png' });
  const bmp = await decodeDataUrl(dataUrl);
  return { dataUrl, width: bmp.width, height: bmp.height };
}

/** Crop a decoded bitmap to a CSS-pixel rectangle, scaled by `dpr`. */
async function cropBitmap(
  bitmap: ImageBitmap,
  crop: { x: number; y: number; width: number; height: number },
  dpr: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const outW = Math.max(1, Math.round(crop.width * dpr));
  const outH = Math.max(1, Math.round(crop.height * dpr));
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  // Clamp the source rect to the captured bitmap so partially-offscreen picks
  // still produce something instead of transparent garbage.
  const sx = Math.min(bitmap.width, Math.max(0, Math.round(crop.x * dpr)));
  const sy = Math.min(bitmap.height, Math.max(0, Math.round(crop.y * dpr)));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(crop.width * dpr)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(crop.height * dpr)));
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const dataUrl = await blobToDataUrl(blob);
  return { dataUrl, width: outW, height: outH };
}

async function cropDataUrl(
  dataUrl: string,
  crop: { x: number; y: number; width: number; height: number },
  dpr: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return cropBitmap(await decodeDataUrl(dataUrl), crop, dpr);
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

/** Region pick → crop. The extra delay lets the dim/box overlay leave the
 *  compositor so it is not baked into the capture. */
async function capturePickedRegion(tabId: number, windowId: number | undefined): Promise<{ dataUrl: string; width: number; height: number }> {
  const region = await pickRegionInTab(tabId);
  await sleep(240);
  const shot = await captureActiveTab(windowId);
  return cropDataUrl(shot.dataUrl, region, region.devicePixelRatio);
}

/** Element pick → crop (same overlay-settle delay as regions). */
async function capturePickedElement(tabId: number, windowId: number | undefined): Promise<{ dataUrl: string; width: number; height: number }> {
  const picked = await pickElementInTab(tabId);
  await sleep(240);
  const shot = await captureActiveTab(windowId);
  return cropDataUrl(shot.dataUrl, picked.rect, picked.devicePixelRatio);
}

/** Element by direct CSS selector: resolve + scroll it into the top-left of
 *  the viewport, then capture & crop from the origin. */
async function captureSelectorElement(
  tabId: number,
  windowId: number | undefined,
  selector: string,
): Promise<{ dataUrl: string; width: number; height: number }> {
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
    args: [selector],
  });
  const info = elInfo[0]?.result as
    | { x: number; y: number; width: number; height: number; dpr: number; sx: number; sy: number }
    | null
    | undefined;
  if (!info) throw new Error(`No element matches "${selector}"`);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (sx: number, sy: number) => window.scrollTo(sx, sy),
    args: [info.sx + info.x, info.sy + info.y],
  });
  await sleep(160);
  const shot = await captureActiveTab(windowId);
  return cropDataUrl(shot.dataUrl, { x: 0, y: 0, width: info.width, height: info.height }, info.dpr);
}

/** Ask the content script in `tabId` to render the floating result card. */
async function showResultCardOnPage(
  tabId: number,
  result: { dataUrl: string; width: number; height: number },
  filename: string,
): Promise<void> {
  await ensureContentScript(tabId);
  const message: PickerResult = {
    type: 'PICKER_RESULT',
    ok: true,
    dataUrl: result.dataUrl,
    filename,
    width: result.width,
    height: result.height,
  };
  await chrome.tabs
    .sendMessage(tabId, message)
    .catch(() => { /* tab navigated or closed — nothing to show */ });
}

/**
 * Capture the full scrollable page by stitching together several
 * captureVisibleTab snapshots while scrolling. Works for any same-origin page;
 * cross-origin iframes may show as empty. The window must be focused and its
 * active tab set to `tabId` before calling.
 */
async function captureFullPage(tabId: number, windowId: number | undefined): Promise<{ dataUrl: string; width: number; height: number }> {
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

  const orig = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ x: window.scrollX, y: window.scrollY }),
  });
  const origPos = (orig[0]?.result as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };

  try {
    const canvas = new OffscreenCanvas(Math.round(sw * dpr), Math.round(sh * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cols = Math.ceil(sw / vw);
    const rows = Math.ceil(sh / vh);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * vw;
        const y = r * vh;
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (sx: number, sy: number) => window.scrollTo(sx, sy),
          args: [x, y],
        });
        await sleep(60);
        const tile = await chrome.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: 'png' });
        const bmp = await decodeDataUrl(tile);
        ctx.drawImage(bmp, Math.round(x * dpr), Math.round(y * dpr));
        bmp.close();
      }
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, width: canvas.width, height: canvas.height };
  } finally {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (sx: number, sy: number) => window.scrollTo(sx, sy),
        args: [origPos.x, origPos.y],
      });
    } catch {
      /* tab might have been closed; ignore */
    }
  }
}

/** Run a capture requested by the dashboard. Region / element results are
 *  shown as an on-page card; viewport-style results return to the caller, who
 *  decides whether to hand focus back to the dashboard. */
async function runCapture(req: CaptureRequest): Promise<CaptureResult> {
  const filename = `${safeFilename(req.filename || 'capture')}-${timestamp()}.png`;
  try {
    const tab = await resolveTargetTab();
    if (tab.id == null) throw new Error('Active tab has no id');
    const tabId = tab.id;
    const windowId = tab.windowId;

    switch (req.mode) {
      case 'visible': {
        await focusTab(tab);
        const shot = await captureActiveTab(windowId);
        return ok(filename, shot.dataUrl, shot.width, shot.height);
      }
      case 'fullpage': {
        await focusTab(tab);
        const shot = await captureFullPage(tabId, windowId);
        return ok(filename, shot.dataUrl, shot.width, shot.height);
      }
      case 'selection': {
        await focusTab(tab);
        const cropped = await capturePickedRegion(tabId, windowId);
        await showResultCardOnPage(tabId, cropped, filename);
        return onPageResult(filename, cropped);
      }
      case 'element': {
        await focusTab(tab);
        const cropped = req.selector
          ? await captureSelectorElement(tabId, windowId, req.selector)
          : await capturePickedElement(tabId, windowId);
        await showResultCardOnPage(tabId, cropped, filename);
        return onPageResult(filename, cropped);
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

function onPageResult(filename: string, cropped: { dataUrl: string; width: number; height: number }): CaptureResult {
  return {
    type: 'CAPTURE_RESULT',
    ok: true,
    onPage: true,
    filename,
    width: cropped.width,
    height: cropped.height,
    bytes: dataUrlToBlobSize(cropped.dataUrl),
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

  // Capture: dashboard requests a snapshot. Region / element results are shown
  // as an on-page card in the captured tab; viewport-style results come back to
  // the dashboard popover, so hand focus back to the dashboard afterwards.
  chrome.runtime.onMessage.addListener((msg: CaptureRequest, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || msg.type !== 'CAPTURE_REQUEST') return false;
    const fromDashboard = !!sender.tab?.id;
    runCapture(msg).then(async (res) => {
      sendResponse(res);
      // The SW focuses the target page while capturing. Hand control back to
      // the dashboard when the result is presented there (viewport captures
      // and any failure/cancel), but leave the user on the captured page when
      // a region/element result card was shown there.
      const staysOnPage = res.ok && (msg.mode === 'selection' || msg.mode === 'element');
      if (fromDashboard && !staysOnPage) {
        await focusSenderTab(sender);
      }
    });
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

  // Remember the last real page the user browsed in each window so capture can
  // target it when the dashboard (an extension tab) is the one in front.
  chrome.tabs.onActivated.addListener((info) => {
    void chrome.tabs
      .get(info.tabId)
      .then((tab) => {
        if (tab.id != null && !isLoadixUrl(tab.url)) lastBrowsedTab.set(info.windowId, tab.id);
      })
      .catch(() => {});
  });

  // Clean up pending picks and remembered tabs when a tab is closed.
  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [windowId, id] of lastBrowsedTab) {
      if (id === tabId) lastBrowsedTab.delete(windowId);
    }
    const pending = pendingPicks.get(tabId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingPicks.delete(tabId);
      pending.reject(new Error('Tab closed during selection'));
    }
  });

  // Keyboard shortcut: Alt+Shift+S dims the page the user is on and captures a
  // region. The crop is handed back to that page as a floating card with
  // copy / save actions (service workers have no DOM, so no auto-download).
  chrome.commands?.onCommand.addListener(async (command) => {
    if (command !== 'capture-region') return;
    try {
      const tab = await resolveTargetTab();
      if (tab.id == null) return;
      await focusTab(tab);
      const cropped = await capturePickedRegion(tab.id, tab.windowId);
      const filename = `loadix-region-${timestamp()}.png`;
      await showResultCardOnPage(tab.id, cropped, filename);
    } catch (e) {
      console.warn('[loadix] capture-region failed', e);
    }
  });
});
