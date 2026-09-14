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
import { executeRawRequest, type RawRequest } from '@/engine/runner';
import type { EngineCommand, EngineEvent, EngineState, MetricsSnapshot } from '@/shared/types';
import type { CaptureRequest, CaptureResult, PickedElement, PickedRegion, PickerResult } from '@/shared/capture';
import { handleMediaMessage, startMediaSniffer } from '@/entrypoints/dashboard/media/mediaSniffer';
import { isDouyinPageUrl, isYouTubePageUrl, resolvePageUrl, type FetchTextOptions } from '@/entrypoints/dashboard/media/mediaResolver';
import { failureFromError, type FetcherErrorFields } from '@/entrypoints/dashboard/media/resolveFailure';

/**
 * Attach the network-level truth to a failed fetch.
 *
 * The panel only ever sees `err.message` — the structured fields cannot cross
 * `sendResponse` — so this frame, which holds the real error object, has to be
 * the one that decides WHY. Without it a proxy misconfiguration and a site's
 * 403 arrive as the same sentence, and the user is told to try again later
 * about a network they could have fixed.
 *
 * A rejection carries undici's real cause on `cause.code`; the message is
 * "fetch failed" for all of them (DNS, reset, TLS, timeout).
 */
function enrichFetchError(url: string, error: unknown): Error & FetcherErrorFields {
  const base = error instanceof Error ? error : new Error(String(error));
  const fields = base as Error & FetcherErrorFields;
  if (fields.kind) return fields; // already an HTTP status we raised
  const cause = (base as { cause?: { code?: string } }).cause;
  const code = cause?.code ?? (base.name === 'AbortError' ? 'ETIMEDOUT' : undefined);
  return Object.assign(base, { kind: 'network' as const, url, ...(code ? { code } : {}) });
}

/** Bilibili's CDN refuses any request whose Referer is not a bilibili origin
 *  (verified live: 403 with a foreign or absent Referer, 206 with the site's
 *  own), and no page can set its own Referer — so the extension stamps it on
 *  bilibili CDN requests. This matters for the DASH video track (1080p for a
 *  logged-in session); the muxed html5 MP4 and the audio track are open.
 *
 *  A SESSION rule installed at startup, not a resolve-scoped one like
 *  Douyin's: the download happens later, from the dashboard page, possibly
 *  after the worker has been suspended and restarted. */
const BILI_REFERER_RULE_ID = 51002; // media module's reserved session-rule slot
function ensureBilibiliRefererRule(): void {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return;
  void dnr
    .updateSessionRules({
      removeRuleIds: [BILI_REFERER_RULE_ID],
      addRules: [
        {
          id: BILI_REFERER_RULE_ID,
          priority: 1,
          condition: {
            requestDomains: ['bilivideo.com', 'bilivideo.cn', 'akamaized.net'],
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
              chrome.declarativeNetRequest.ResourceType.OTHER,
            ],
          },
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: 'Referer',
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: 'https://www.bilibili.com/',
              },
            ],
          },
        },
      ],
    })
    .catch(() => undefined);
}

/**
 * YouTube's player endpoint refuses anything that announces an extension
 * origin: `Origin: chrome-extension://…` answers `403` while the same request
 * with YouTube's own origin — or with no Origin at all — answers `200` with
 * every format (verified across the header matrix). The endpoint is POST-only
 * (a GET is `405`), and a browser stamps Origin on its own POSTs, so the rule
 * below is what lets the extension read YouTube at all.
 *
 * Scoped twice over: to the `youtubei` path only, and installed for the
 * duration of a YouTube resolve rather than for the whole session — the user's
 * own YouTube tabs POST to that host too.
 */
const YOUTUBE_ORIGIN_RULE_ID = 51003; // media module's reserved session-rule slot
function setYouTubeOriginRule(install: boolean): Promise<unknown> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return Promise.resolve();
  return dnr
    .updateSessionRules({
      removeRuleIds: [YOUTUBE_ORIGIN_RULE_ID],
      addRules: install
        ? [
            {
              id: YOUTUBE_ORIGIN_RULE_ID,
              priority: 1,
              condition: {
                requestDomains: ['youtube.com'],
                urlFilter: '/youtubei/',
                resourceTypes: [
                  chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
                  chrome.declarativeNetRequest.ResourceType.OTHER,
                ],
              },
              action: {
                type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
                requestHeaders: [
                  {
                    header: 'Origin',
                    operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE,
                  },
                ],
              },
            },
          ]
        : [],
    })
    .catch(() => undefined);
}

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

/** Run a capture requested by the dashboard or the action popup.
 *  `deliverOnPage` is true for popup-launched captures: the result is shown
 *  as a floating card in the captured tab (there is no dashboard popover to
 *  host a preview, and the user never leaves the page they are capturing). */
async function runCapture(req: CaptureRequest, deliverOnPage = false): Promise<CaptureResult> {
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
        if (deliverOnPage) {
          await showResultCardOnPage(tabId, shot, filename);
          return onPageResult(filename, shot);
        }
        return ok(filename, shot.dataUrl, shot.width, shot.height);
      }
      case 'fullpage': {
        await focusTab(tab);
        const shot = await captureFullPage(tabId, windowId);
        if (deliverOnPage) {
          await showResultCardOnPage(tabId, shot, filename);
          return onPageResult(filename, shot);
        }
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

/** Open (or focus) the Loadix workbench dashboard tab. */
async function openDashboard(): Promise<void> {
  const url = chrome.runtime.getURL('/dashboard.html');
  const tabs = await chrome.tabs.query({ url });
  const existing = tabs[0];
  if (existing) {
    await chrome.tabs.update(existing.id ?? 0, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

export default defineBackground(() => {
  // The toolbar icon opens the action popup (capture + open-workbench);
  // requests from that popup are handled below.

  // Engine port: dashboard ↔ service worker.
  chrome.runtime.onConnect.addListener((port) => {
    host.addPort(port);
    port.onMessage.addListener((msg: EngineCommand) => host.handleCommand(msg));
  });

  // Capture: dashboard requests a snapshot. Region / element results are shown
  // as an on-page card in the captured tab; viewport-style results come back to
  // the dashboard popover, so hand focus back to the dashboard afterwards.
  chrome.runtime.onMessage.addListener((msg: { type?: string } | CaptureRequest, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.type === 'OPEN_DASHBOARD') {
      void openDashboard().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type !== 'CAPTURE_REQUEST') return false;

    // Sender is the dashboard only when the message comes from the Loadix
    // extension page itself. The action popup has no dashboard tab behind it —
    // the active tab is the page the user is looking at — so its results are
    // delivered as an on-page floating card, never by tab-juggling.
    const req = msg as CaptureRequest;
    const senderIsDashboard = !!sender.tab?.url && isLoadixUrl(sender.tab.url);
    runCapture(req, !senderIsDashboard).then(async (res) => {
      sendResponse(res);
      // When launched from the dashboard, hand control back to it for
      // viewport captures and for any failure/cancel; region/element picks
      // leave the user on the captured page with the result card.
      if (senderIsDashboard) {
        const staysOnPage = res.ok && (req.mode === 'selection' || req.mode === 'element');
        if (!staysOnPage) await focusSenderTab(sender);
      }
    });
    return true; // tell Chrome we'll respond asynchronously
  });

  // Requests module: execute a single API request in the SW. Running the
  // fetch here (instead of the dashboard page) exempts it from CORS via
  // host_permissions — the same trick that powers the load engine. Each
  // request gets its own AbortController so the dashboard's Stop button can
  // cancel it mid-flight (API_ABORT).
  const pendingApiRequests = new Map<string, AbortController>();
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    const { type } = msg as { type?: string };
    if (type === 'API_REQUEST') {
      const { id, request } = msg as { id: string; request: RawRequest };
      const controller = new AbortController();
      pendingApiRequests.set(id, controller);
      executeRawRequest(request, { signal: controller.signal }).then((res) => {
        pendingApiRequests.delete(id);
        sendResponse(res);
      });
      return true; // respond asynchronously
    }
    if (type === 'API_ABORT') {
      pendingApiRequests.get((msg as { id: string }).id)?.abort();
    }
    return false;
  });

  // The recorder content script learns its own tab id from the SW so its
  // recording state + buffer can be persisted in chrome.storage.session
  // under a tab-scoped key and restored after a page reload.
  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    if ((msg as { type?: string }).type !== 'recorder:tabid') return false;
    sendResponse({ type: 'recorder:tabid', tabId: sender.tab?.id ?? null });
    return false;
  });

  // Media sniffer: the dashboard asks for the current tab's captured assets
  // (media:list) and can clear them (media:clear). Classification + buffering
  // live in mediaSniffer.ts; downloads run in the dashboard page itself.
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    const { type } = msg as { type?: string };
    if (type !== 'media:list' && type !== 'media:clear') return false;
    return handleMediaMessage(msg as { type?: string; tabId?: number }, sendResponse);
  });

  // Media page-resolve: the user pasted a video PAGE url (bilibili.com/video/…).
  // All network runs here — host_permissions make the SW CORS-exempt, so the
  // watch page AND Bilibili's html5 playurl API are readable. resolvePageUrl
  // (unit-tested, network injected) returns the selectable format list:
  // muxed MP4s with sound first, DASH tracks labeled video-only as fallback.
  // Douyin serves its share-page video data only to MOBILE user agents, and a
  // service worker cannot set User-Agent on a plain fetch — so for Douyin
  // resolves we install a scoped declarativeNetRequest session rule that
  // rewrites the UA on iesdouyin.com requests, then remove it afterwards.
  const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
  const DOUYIN_UA_RULE_ID = 51001; // media module's reserved session-rule slot
  ensureBilibiliRefererRule();
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    if ((msg as { type?: string }).type !== 'media:scrape') return false;
    const pageUrl = (msg as { pageUrl?: string }).pageUrl ?? '';
    if (!/^https?:\/\//i.test(pageUrl)) {
      sendResponse({ type: 'media:scrape', error: 'not-http', failure: { reason: 'bad-url' } });
      return false;
    }
    // 'include' so Douyin's first pass can persist its ttwid Set-Cookie and
    // the retry presents it (the same two-pass the server core performs).
    // `credentials: 'include'` sends the user's bilibili.com session, which
    // is what upgrades a resolve from 720p to 1080p DASH. The post-redirect
    // URL is reported separately so b23.tv share codes canonicalize.
    const fetchWithUrl = (url: string, options?: FetchTextOptions) =>
      fetch(url, {
        credentials: 'include',
        // Site adapters may need a POST with their own client headers —
        // YouTube's player endpoint is POST-only. A service worker cannot set
        // User-Agent, which is fine: that client works with any UA.
        method: options?.method ?? 'GET',
        ...(options?.headers ? { headers: options.headers } : {}),
        ...(options?.body != null ? { body: options.body } : {}),
      })
        .then(async (res) => {
          if (!res.ok) {
            throw Object.assign(new Error(`HTTP ${res.status}`), {
              kind: 'http' as const,
              url,
              status: res.status,
            });
          }
          return { text: await res.text(), finalUrl: res.url || url };
        })
        .catch((err: unknown) => {
          throw enrichFetchError(url, err);
        });
    const fetchText = (url: string, options?: FetchTextOptions) => fetchWithUrl(url, options).then((result) => result.text);
    const needsMobileUa = isDouyinPageUrl(pageUrl) && !!chrome.declarativeNetRequest?.updateSessionRules;
    const needsNoOrigin = isYouTubePageUrl(pageUrl) && !!chrome.declarativeNetRequest?.updateSessionRules;
    const restoreRules = () => {
      if (needsMobileUa) {
        void chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [DOUYIN_UA_RULE_ID], addRules: [] });
      }
      if (needsNoOrigin) void setYouTubeOriginRule(false);
    };
    const run = () =>
      resolvePageUrl(pageUrl, fetchText, fetchWithUrl)
        .then((resolved) => sendResponse({ type: 'media:scrape', resolved }))
        .catch((err: unknown) => {
          sendResponse({
            type: 'media:scrape',
            error: err instanceof Error ? err.message : 'resolve-failed',
            // Classified HERE, where the error object still exists: across the
            // message boundary only its message survives.
            failure: failureFromError(err, pageUrl),
          });
        })
        .finally(restoreRules);
    // Every rule this resolve needs must be INSTALLED before its first request
    // goes out — a fire-and-forget install races the fetch. Both are session
    // rules removed again in `restoreRules`, so nothing outlives the resolve.
    const installRules = (): Promise<unknown> => {
      const jobs: Promise<unknown>[] = [];
      if (needsMobileUa) {
        jobs.push(
          chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [DOUYIN_UA_RULE_ID],
            addRules: [
              {
                id: DOUYIN_UA_RULE_ID,
                priority: 1,
                condition: {
                  requestDomains: ['iesdouyin.com'],
                  resourceTypes: [
                    chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
                    chrome.declarativeNetRequest.ResourceType.OTHER,
                  ],
                },
                action: {
                  type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
                  requestHeaders: [
                    { header: 'User-Agent', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: MOBILE_UA },
                  ],
                },
              },
            ],
          }),
        );
      }
      if (needsNoOrigin) jobs.push(setYouTubeOriginRule(true));
      return jobs.length ? Promise.allSettled(jobs) : Promise.resolve();
    };
    void installRules().then(run, run);
    return true; // async response
  });

  startMediaSniffer();

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
