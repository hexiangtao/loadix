/**
 * Page-URL ingestion — the paste box's answer to "I pasted a video page".
 *
 * Users paste `bilibili.com/video/BV…`, not CDN URLs. In extension mode the
 * background worker can fetch that page (host_permissions make it
 * CORS-exempt) and this module mines the HTML for media:
 *
 *   1. Bilibili-style `window.__playinfo__` JSON → DASH video/audio tracks
 *      (labeled as separate tracks — muxing lands in v2) and legacy `durl`
 *      direct files.
 *   2. Generic scan for .m3u8 / .mp4 / .mpd URLs anywhere in the markup —
 *      covers players that embed the playlist in a bootstrap script.
 *
 * Pure text-in/assets-out so the tricky sites stay unit-testable.
 */

import { assetIdFor, classifyRequest } from './mediaClassify';
import type { MediaAsset } from './mediaTypes';

/** Hard cap — pages with giant inline scripts shouldn't OOM the SW. */
const HTML_SCAN_CAP = 3_000_000;

export function extractMediaFromHtml(html: string, pageUrl: string): MediaAsset[] {
  const out = new Map<string, MediaAsset>();
  const text = html.slice(0, HTML_SCAN_CAP);

  const add = (raw: (Omit<MediaAsset, 'id' | 'firstSeenAt' | 'lastSeenAt' | 'hits'> & { fileName?: string }) | null): void => {
    if (!raw) return;
    const asset: MediaAsset = {
      ...raw,
      id: assetIdFor(raw.url),
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      hits: 1,
    };
    // First source wins: playinfo tracks beat generic-scan duplicates.
    if (!out.has(asset.id)) out.set(asset.id, asset);
  };

  extractBilibiliPlayinfo(text, pageUrl, add);
  extractGenericUrls(text, pageUrl, add);

  return [...out.values()];
}

type Adder = (asset: (Omit<MediaAsset, 'id' | 'firstSeenAt' | 'lastSeenAt' | 'hits'> & { fileName?: string }) | null) => void;

/** `window.__playinfo__ = {...}` — Bilibili's embedded DASH manifest. */
function extractBilibiliPlayinfo(html: string, pageUrl: string, add: Adder): void {
  const match = html.match(/window\.__playinfo__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i);
  if (!match?.[1]) return;
  let info: {
    data?: {
      dash?: {
        video?: { baseUrl?: string; backupUrl?: string[]; bandwidth?: number; width?: number; height?: number }[];
        audio?: { baseUrl?: string; bandwidth?: number }[];
      };
      durl?: { url?: string; size?: number }[];
    };
  };
  try {
    info = JSON.parse(match[1]);
  } catch {
    return;
  }
  const host = safeHost(pageUrl) || 'page';
  const dash = info.data?.dash;

  // Highest-resolution video track first, but keep a couple of options —
  // the details rail explains that DASH tracks are separate (no audio).
  const videos = [...(dash?.video ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0));
  videos.slice(0, 3).forEach((video, index) => {
    if (!video.baseUrl) return;
    add(
      classifyRequest({ url: video.baseUrl, live: false, pageUrl }) && {
        ...(classifyRequest({ url: video.baseUrl, live: false, pageUrl })!),
        kind: 'video',
        container: 'dash',
        fileName: `${host}-video-${resolution(video)}${index === 0 ? '' : `-alt${index}`}.m4s`,
        size: null,
      },
    );
  });

  (dash?.audio ?? []).slice(0, 1).forEach((audio) => {
    if (!audio.baseUrl) return;
    add(
      classifyRequest({ url: audio.baseUrl, live: false, pageUrl }) && {
        ...(classifyRequest({ url: audio.baseUrl, live: false, pageUrl })!),
        kind: 'audio',
        container: 'dash',
        fileName: `${host}-audio.m4s`,
        size: null,
      },
    );
  });

  // Legacy direct files (durl) — these download fully in v1.
  (info.data?.durl ?? []).slice(0, 3).forEach((entry) => {
    if (!entry.url) return;
    add(classifyRequest({ url: entry.url, live: false, pageUrl, contentLength: entry.size ?? null }));
  });
}

/** Any media-looking URL in the markup: m3u8/mp4/mpd. */
function extractGenericUrls(html: string, pageUrl: string, add: Adder): void {
  const pattern = /https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^"'\\\s<>]*)?/gi;
  for (const match of html.matchAll(pattern)) {
    add(classifyRequest({ url: match[0], live: false, pageUrl }));
  }
}

function resolution(video: { width?: number; height?: number; bandwidth?: number }): string {
  if (video.height) return `${video.height}p`;
  if (video.bandwidth) return `${Math.round(video.bandwidth / 1000)}k`;
  return 'track';
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
