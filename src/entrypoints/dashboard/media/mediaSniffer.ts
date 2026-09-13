/**
 * Media sniffer — background service worker side.
 *
 * A single `chrome.webRequest` observer (observational, no blocking) sees
 * every network request of every tab — including MSE/blob-mediated segment
 * fetches that DOM hooking struggles with. Events are classified through
 * the same pure `mediaClassify.ts` the web paste-URL box uses, then kept in
 * a per-tab ring buffer. The dashboard's Media panel asks for `media:list`
 * when it opens and receives `media:update` pushes afterwards.
 *
 * Nothing is persisted to disk: captured URLs routinely embed short-lived
 * tokens, so the buffer lives and dies with the browser session
 * (`chrome.storage.session` gives tab-scoped restore across SW restarts).
 */

import { assetIdFor, classifyRequest } from '@/entrypoints/dashboard/media/mediaClassify';
import type { MediaAsset } from '@/entrypoints/dashboard/media/mediaTypes';

const MAX_ASSETS_PER_TAB = 400;
const STORAGE_PREFIX = 'media:tab:';
const PRUNE_KEEP_BYTES = 20 * 1024 * 1024;

/** tabId → url → asset (dedup by cache-buster-trimmed identity). */
const tabs = new Map<number, Map<string, MediaAsset>>();

function storeFor(tabId: number): Map<string, MediaAsset> {
  let map = tabs.get(tabId);
  if (!map) {
    map = new Map();
    tabs.set(tabId, map);
  }
  return map;
}

function persist(tabId: number): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return;
  const map = tabs.get(tabId);
  if (!map) return;
  const assets = [...map.values()].slice(-MAX_ASSETS_PER_TAB);
  void chrome.storage.session.set({ [`${STORAGE_PREFIX}${tabId}`]: assets }).catch(() => undefined);
}

/** Coalesce bursts of persists (every sniffed segment fires one) — the
 *  trailing call wins and the map holds the freshest state anyway. */
const persistTimers = new Map<number, ReturnType<typeof setTimeout>>();
function schedulePersist(tabId: number): void {
  const existing = persistTimers.get(tabId);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    tabId,
    setTimeout(() => {
      persistTimers.delete(tabId);
      persist(tabId);
    }, 1500),
  );
}

async function restore(tabId: number): Promise<Map<string, MediaAsset>> {
  const existing = tabs.get(tabId);
  if (existing && existing.size > 0) return existing;
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return storeFor(tabId);
  try {
    const key = `${STORAGE_PREFIX}${tabId}`;
    const bag = await chrome.storage.session.get(key);
    const assets = (bag[key] as MediaAsset[] | undefined) ?? [];
    const map = storeFor(tabId);
    for (const asset of assets) map.set(asset.id, asset);
  } catch {
    /* storage unavailable — memory-only */
  }
  return storeFor(tabId);
}

function record(tabId: number, asset: MediaAsset): void {
  const map = storeFor(tabId);
  const existing = map.get(asset.id);
  if (existing) {
    existing.hits++;
    existing.lastSeenAt = asset.firstSeenAt;
    if (asset.size != null) existing.size = asset.size;
    if (asset.contentType && !existing.contentType) existing.contentType = asset.contentType;
    return;
  }
  // Segment flood guard: .ts/.m4s files under one directory are HLS/DASH
  // siblings. A VOD playlist downloads hundreds of them; showing each as a
  // row would drown the playlist the user actually wants. Aggregate into
  // the first sibling's row and keep the playlist (already captured) as
  // the downloadable entry.
  if (/\.(ts|m4s)(\?|$)/i.test(asset.url)) {
    for (const row of map.values()) {
      if (row.segmentCount && sameSegmentFamily(row.url, asset.url)) {
        row.segmentCount++;
        row.lastSeenAt = asset.firstSeenAt;
        row.size = (row.size ?? 0) + (asset.size ?? 0);
        return;
      }
    }
  }
  map.set(asset.id, asset);
  prune(map);
}

/** True when two segment URLs share a directory and differ only by a
 *  trailing identifier (number / hash token) — a segment family. */
function sameSegmentFamily(a: string, b: string): boolean {
  try {
    const pa = new URL(a);
    const pb = new URL(b);
    if (pa.origin !== pb.origin) return false;
    const da = pa.pathname.split('/');
    const db = pb.pathname.split('/');
    const lastA = da.pop() ?? '';
    const lastB = db.pop() ?? '';
    if (da.join('/') !== db.join('/')) return false;
    // Same extension family, differing (or empty) trailing token.
    const stem = (name: string) => name.replace(/\.[a-z0-9]{1,5}(\?|$)/i, '').replace(/\d+$/, '');
    return stem(lastA) === stem(lastB) && /\.[a-z0-9]{1,5}(\?|$)/i.test(lastA);
  } catch {
    return false;
  }
}

/** Keep the buffer useful: drop oldest 'image'/'other' first, then oldest. */
function prune(map: Map<string, MediaAsset>): void {
  if (map.size <= MAX_ASSETS_PER_TAB) return;
  const ordered = [...map.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt);
  let bytes = ordered.reduce((sum, a) => sum + (a.size ?? 0), 0);
  for (const asset of ordered) {
    if (map.size <= MAX_ASSETS_PER_TAB * 0.9 && bytes <= PRUNE_KEEP_BYTES) break;
    if (asset.kind === 'image' || asset.kind === 'other') {
      map.delete(asset.id);
      bytes -= asset.size ?? 0;
    }
  }
  for (const asset of ordered) {
    if (map.size <= MAX_ASSETS_PER_TAB * 0.9) break;
    map.delete(asset.id);
  }
}

/* ------------------------------------------------------------------ */
/* webRequest observation                                              */
/* ------------------------------------------------------------------ */

interface WebRequestDetail {
  url: string;
  method: string;
  tabId: number;
  requestId: string;
  statusCode?: number;
  type?: string;
  responseHeaders?: { name: string; value?: string }[];
  originUrl?: string;
  documentUrl?: string;
  frameId?: number;
}

function headerValue(headers: { name: string; value?: string }[] | undefined, name: string): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  for (const header of headers) {
    if (header.name.toLowerCase() === lower) return header.value ?? null;
  }
  return null;
}

/** A request is attributed to a tab when webRequest saw it in that tab. */
function pageUrlFor(detail: WebRequestDetail): string {
  return detail.originUrl ?? detail.documentUrl ?? '';
}

function handleDetail(detail: WebRequestDetail): void {
  if (detail.tabId == null || detail.tabId < 0) return; // prerender / SW itself
  const contentType = headerValue(detail.responseHeaders, 'content-type') ?? '';
  const contentLengthRaw = headerValue(detail.responseHeaders, 'content-length');
  const contentLength = contentLengthRaw ? Number(contentLengthRaw) : null;

  // Cheap pre-filter before the full classify: extensionless URLs with no
  // media content-type are the vast majority of traffic.
  const quickLook = /\.(m3u8|mpd|mp4|m4s|ts|m4v|mov|webm|mkv|mp3|m4a|aac|ogg|opus|wav|flac|vtt|srt)(\?|$)/i.test(detail.url);
  const mediaType = /(video|audio|mpegurl|dash|mp2t|octet-stream)/i.test(contentType);
  if (!quickLook && !mediaType) return;

  const asset = classifyRequest({
    url: detail.url,
    method: detail.method,
    contentType: contentType || undefined,
    contentLength: Number.isFinite(contentLength) ? contentLength : null,
    pageUrl: pageUrlFor(detail),
  });
  if (!asset) return;

  record(detail.tabId, {
    ...asset,
    id: assetIdFor(detail.url),
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    hits: 1,
  });
  schedulePersist(detail.tabId);
}

function installObserver(): void {
  if (typeof chrome === 'undefined' || !chrome.webRequest?.onHeadersReceived) return;
  const filter = { urls: ['<all_urls>'] };
  chrome.webRequest.onHeadersReceived.addListener(
    (detail) => handleDetail(detail as WebRequestDetail),
    filter,
    ['responseHeaders'],
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard messages                                                  */
/* ------------------------------------------------------------------ */

export function handleMediaMessage(
  msg: { type?: string; tabId?: number },
  sendResponse: (response: unknown) => void,
): boolean {
  if (msg.type === 'media:list') {
    const tabId = msg.tabId;
    if (typeof tabId !== 'number') {
      sendResponse({ type: 'media:list', assets: [] });
      return false;
    }
    void restore(tabId).then((map) => {
      sendResponse({ type: 'media:list', assets: [...map.values()] });
    });
    return true; // async response
  }
  if (msg.type === 'media:clear') {
    const tabId = msg.tabId;
    if (typeof tabId === 'number') {
      tabs.delete(tabId);
      void chrome.storage?.session?.remove(`${STORAGE_PREFIX}${tabId}`)?.catch?.(() => undefined);
    }
    sendResponse({ type: 'media:clear', ok: true });
    return false;
  }
  return false;
}

export function mediaSnapshot(tabId: number): MediaAsset[] {
  return [...(tabs.get(tabId)?.values() ?? [])];
}

export function startMediaSniffer(): void {
  installObserver();
}
