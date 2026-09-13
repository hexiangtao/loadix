/**
 * Page-URL resolution — paste a watch page, get downloadable formats.
 *
 * The promise the product makes: copy a playback page URL → see the real
 * format list (muxed MP4 "with sound", DASH tracks, etc.) → pick one →
 * download a complete playable file. This module owns the resolve step.
 *
 * Bilibili path (HTML5 fallback chain, no login for most videos):
 *   1. GET the watch page → scrape `window.__playinfo__` (embedded DASH
 *      manifest) and `cid` + `bvid`.
 *   2. GET `api.bilibili.com/x/player/playurl?bvid=…&cid=…&platform=html5`
 *      → `durl` array of **muxed MP4s with sound** (format ids 16/32/64 =
 *      360p/480p/720p). This is the "just works" answer.
 *   3. Fall back to playinfo DASH tracks (video-only, labeled) when the
 *      HTML5 API refuses (some regions/encodings).
 *
 * Generic path for other sites: mine the HTML for direct media URLs and
 * HLS playlists (optionally resolving one level of playlist variants).
 * Pure functions over fetched text — network is injected, so tests mock it.
 */

import { assetIdFor } from './mediaClassify';
import type { MediaAsset, MediaVariant } from './mediaTypes';

/** One selectable download format for an asset row. */
export interface MediaFormatOption {
  /** Stable key for React lists: `mp4-64` / `dash-video-1080` … */
  key: string;
  /** Label chip: "MP4 · 720p · 有声音" style, built by the UI from parts. */
  container: 'mp4' | 'hls' | 'dash-video' | 'dash-audio' | 'file';
  quality: string;
  /** The muxed file carries its own audio track. */
  hasAudio: boolean;
  /** Byte size when the source declared one (0 = unknown). */
  size: number;
  /** URL to download for this format. */
  url: string;
  /** Alternate CDN mirrors tried in order on failure. */
  backupUrls: string[];
}

/** A resolved page: one row per logical stream, each with its formats. */
export interface ResolvedPageAsset {
  title: string;
  pageUrl: string;
  formats: MediaFormatOption[];
  /** Set when resolution only found DASH (no muxed option). */
  dashOnly: boolean;
  /** Site-specific explanation shown in the UI (i18n key suffix). */
  notice: '' | 'dash-only' | 'empty';
}

/** Minimal fetch signature so tests can stub network. */
export type FetchText = (url: string) => Promise<string>;

const UA_HINT = 'html5';

/* ------------------------------------------------------------------ */
/* Bilibili                                                            */
/* ------------------------------------------------------------------ */

const BILIBILI_PAGE = /bilibili\.com\/video\/(BV[\w]+)/i;

/** Known html5-API quality ids → label (higher = better). */
const BILI_MP4_QUALITY: Record<number, string> = {
  16: '360p',
  32: '480p',
  64: '720p',
};

export async function resolvePageUrl(pageUrl: string, fetchText: FetchText): Promise<ResolvedPageAsset> {
  if (BILIBILI_PAGE.test(pageUrl)) {
    const bili = await resolveBilibili(pageUrl, fetchText).catch(() => null);
    if (bili) return bili;
  }
  return resolveGeneric(pageUrl, fetchText);
}

async function resolveBilibili(pageUrl: string, fetchText: FetchText): Promise<ResolvedPageAsset | null> {
  const bvid = pageUrl.match(BILIBILI_PAGE)?.[1];
  if (!bvid) return null;

  // 1. Watch page: cid + embedded playinfo.
  const html = await fetchText(pageUrl);
  const cid = html.match(/"cid":(\d+)/)?.[1] ?? html.match(/cid=(\d+)/)?.[1] ?? '';
  const title = html.match(/<title[^>]*>([^<]+)/)?.[1]?.trim().replace(/_哔哩哔哩.*$/, '') || bvid;

  const formats: MediaFormatOption[] = [];

  // 2. HTML5 playurl API → muxed MP4s with sound. The headline feature.
  if (cid) {
    try {
      const api = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&platform=${UA_HINT}&high_quality=1`;
      const payload = JSON.parse(await fetchText(api)) as {
        data?: {
          quality?: number;
          durl?: { url?: string; backup_url?: string[]; size?: number }[];
          accept_quality?: number[];
        };
      };
      const durl = payload.data?.durl ?? [];
      durl.forEach((part, index) => {
        if (!part.url) return;
        formats.push({
          key: `mp4-${payload.data?.quality ?? 'x'}-${index}`,
          container: 'mp4',
          quality: BILI_MP4_QUALITY[payload.data?.quality ?? 0] ?? 'MP4',
          hasAudio: true,
          size: part.size ?? 0,
          url: part.url,
          backupUrls: part.backup_url ?? [],
        });
      });
      // high_quality=1 caps at 720p; also probe the explicit ids so the
      // user gets the full list (16/32/64).
      for (const qid of payload.data?.accept_quality ?? [64, 32, 16]) {
        if (!BILI_MP4_QUALITY[qid]) continue;
        if (formats.some((f) => f.quality === BILI_MP4_QUALITY[qid])) continue;
        try {
          const qPayload = JSON.parse(
            await fetchText(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&platform=${UA_HINT}&qn=${qid}`),
          ) as { data?: { durl?: { url?: string; backup_url?: string[]; size?: number }[] } };
          const first = qPayload.data?.durl?.[0];
          if (first?.url) {
            formats.push({
              key: `mp4-${qid}`,
              container: 'mp4',
              quality: BILI_MP4_QUALITY[qid]!,
              hasAudio: true,
              size: first.size ?? 0,
              url: first.url,
              backupUrls: first.backup_url ?? [],
            });
          }
        } catch {
          /* quality refused — skip it */
        }
      }
    } catch {
      /* API refused (region/login wall) — DASH fallback below still gives tracks */
    }
  }

  // 3. Embedded playinfo DASH tracks — always video-only, labeled as such.
  const playinfoAssets = extractPlayinfoFormats(html, pageUrl);
  formats.push(...playinfoAssets);

  const deduped = dedupeFormats(formats);
  const muxed = deduped.filter((f) => f.container === 'mp4');
  return {
    title,
    pageUrl,
    formats: deduped,
    dashOnly: muxed.length === 0 && deduped.length > 0,
    notice: deduped.length === 0 ? 'empty' : muxed.length === 0 ? 'dash-only' : '',
  };
}

/** `window.__playinfo__` → DASH format options (video + audio, separate). */
function extractPlayinfoFormats(html: string, pageUrl: string): MediaFormatOption[] {
  const match = html.match(/window\.__playinfo__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i);
  if (!match?.[1]) return [];
  let info: {
    data?: {
      dash?: {
        video?: { baseUrl?: string; backupUrl?: string[]; bandwidth?: number; width?: number; height?: number; id?: number }[];
        audio?: { baseUrl?: string; backupUrl?: string[]; bandwidth?: number }[];
      };
    };
  };
  try {
    info = JSON.parse(match[1]);
  } catch {
    return [];
  }
  const dash = info.data?.dash;
  const out: MediaFormatOption[] = [];
  const videos = [...(dash?.video ?? [])].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
  );
  // One row per quality (dedupe by height — Bilibili lists many codecs per q).
  const seenHeights = new Set<number>();
  for (const video of videos) {
    if (!video.baseUrl || !video.height || seenHeights.has(video.height)) continue;
    seenHeights.add(video.height);
    out.push({
      key: `dash-video-${video.height}`,
      container: 'dash-video',
      quality: `${video.height}p`,
      hasAudio: false,
      size: 0,
      url: video.baseUrl,
      backupUrls: video.backupUrl ?? [],
    });
  }
  const audio = dash?.audio?.[0];
  if (audio?.baseUrl) {
    out.push({
      key: 'dash-audio',
      container: 'dash-audio',
      quality: '音频',
      hasAudio: true,
      size: 0,
      url: audio.baseUrl,
      backupUrls: audio.backupUrl ?? [],
    });
  }
  void pageUrl;
  return out;
}

/* ------------------------------------------------------------------ */
/* Generic sites                                                       */
/* ------------------------------------------------------------------ */

async function resolveGeneric(pageUrl: string, fetchText: FetchText): Promise<ResolvedPageAsset> {
  const html = await fetchText(pageUrl);
  const title = html.match(/<title[^>]*>([^<]+)/)?.[1]?.trim() || safeHost(pageUrl);
  const formats: MediaFormatOption[] = [];

  const pattern = /https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^"'\\\s<>]*)?/gi;
  const seen = new Set<string>();
  for (const match of html.matchAll(pattern)) {
    const url = match[0];
    const id = assetIdFor(url);
    if (seen.has(id)) continue;
    seen.add(id);
    if (/\.m3u8(\?|$)/i.test(url)) {
      formats.push({ key: `hls-${formats.length}`, container: 'hls', quality: 'HLS', hasAudio: true, size: 0, url, backupUrls: [] });
    } else {
      formats.push({ key: `mp4-${formats.length}`, container: 'mp4', quality: 'MP4', hasAudio: true, size: 0, url, backupUrls: [] });
    }
  }

  return {
    title,
    pageUrl,
    formats,
    dashOnly: false,
    notice: formats.length === 0 ? 'empty' : '',
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function dedupeFormats(formats: MediaFormatOption[]): MediaFormatOption[] {
  const out = new Map<string, MediaFormatOption>();
  for (const format of formats) {
    const key = `${format.container}-${format.quality}`;
    if (!out.has(key)) out.set(key, format);
  }
  // Muxed MP4s first (the default answer), then DASH video best-first,
  // then audio.
  const order: Record<MediaFormatOption['container'], number> = { mp4: 0, hls: 1, 'dash-video': 2, 'dash-audio': 3, file: 4 };
  return [...out.values()].sort((a, b) => order[a.container] - order[b.container]);
}

export function fileNameForFormat(title: string, format: MediaFormatOption): string {
  const safe = title.replace(/[\\/:*?"<>|]/g, '').slice(0, 80).trim() || 'video';
  const ext = format.container === 'hls' ? 'ts' : format.container === 'mp4' || format.container === 'file' ? 'mp4' : 'm4s';
  return `${safe}${format.container === 'dash-video' ? `-${format.quality}` : ''}.${ext}`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
