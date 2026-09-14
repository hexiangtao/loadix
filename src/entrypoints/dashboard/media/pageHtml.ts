/**
 * Pure HTML/JSON extraction shared by every site adapter.
 *
 * Watch pages across these sites are all the same shape of problem: a
 * server-rendered HTML document with a JSON blob buried in a `<script>`
 * (Bilibili `__playinfo__`, its PGC twin `playurlSSRData`, AcFun's
 * `ksPlayJson`, and the Maccms `player_aaaa` config on thousands of
 * smaller Chinese sites). This module is the one place that knows how to
 * pull such a blob out and turn DASH tracks into format rows, so a new
 * adapter is mostly "find the blob, hand it over".
 *
 * Everything here is a pure function over text: no network, no globals.
 */

import type { MediaFormatOption, VideoPart } from './mediaResolver';

/* ------------------------------------------------------------------ */
/* Embedded JSON                                                       */
/* ------------------------------------------------------------------ */

/** Read a balanced JSON value starting at `open` (the index of its `{` or
 *  `[`), tracking nesting so a nested object cannot end the scan early.
 *  Bracket counting rather than a regex because these blobs contain real
 *  nested objects and arrays, and a lazy `\{.*?\}` stops at the wrong brace
 *  — which is exactly how a part list silently loses its second entry. */
function sliceBalanced(text: string, open: number): string | null {
  const first = text[open];
  if (first !== '{' && first !== '[') return null;
  const close = first === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let at = open; at < text.length; at += 1) {
    const char = text[at]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === first) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(open, at + 1);
    }
  }
  return null;
}

/** Keep the old name: Bilibili's part list is an array, and the callers
 *  read better with it. `open` is the index of the `[`. */
export function sliceJsonArray(text: string, open: number): string | null {
  return sliceBalanced(text, open);
}

/**
 * Parse the first JSON object/array following `marker` in a page.
 *
 * Handles the three ways these pages embed data:
 *   1. a real object literal — `window.__playinfo__ = { … }`
 *   2. a JSON *string* — AcFun ships `"ksPlayJson":"{\"adaptationSet\":…}"`,
 *      which needs one extra decode
 *   3. a reference to a value defined elsewhere — Bilibili PGC pages write
 *      `window.__playinfo__ = playurlSSRData.data`, so callers pass the
 *      marker of the *definition* (`playurlSSRData`) instead
 *
 * Returns null rather than throwing: a page that changed shape should
 * degrade to the generic scan, not blow up the resolve.
 */
export function embeddedJson<T = unknown>(text: string, marker: string): T | null {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const tail = text.slice(at + marker.length);

  // Shape 2 first: a JSON string of JSON. It must be tested BEFORE the
  // object scan, because the escaped payload contains braces and escaped
  // quotes that a brace scanner would misread as real structure.
  const literal = tail.match(/^\\?"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (literal?.[1]) {
    try {
      return JSON.parse(JSON.parse(`"${literal[1]}"`)) as T;
    } catch {
      /* not a JSON string after all — fall through to the object scan */
    }
  }

  // Shape 1 / 3: a real object literal (or a reference to one elsewhere in
  // the page, which the caller finds by passing that definition's marker).
  const open = tail.search(/[{[]/);
  if (open < 0) return null;
  const raw = sliceBalanced(text, at + marker.length + open);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Small text helpers                                                  */
/* ------------------------------------------------------------------ */

/** HTML entities that show up in titles and attributes. */
export function decodeEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#x27;', "'")
    .replaceAll('&nbsp;', ' ');
}

/** Covers arrive protocol-relative or over plain http; downloads need https. */
export function normalizeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  return url.replace(/^http:\/\//i, 'https://');
}

/** The document's `<title>`, trimmed of the site's own suffix. */
export function pageTitle(html: string, stripSuffix?: RegExp): string | undefined {
  const raw = html.match(/<title[^>]*>([^<]+)/i)?.[1];
  if (!raw) return undefined;
  const cleaned = decodeEntities(raw).replace(stripSuffix ?? /$^/, '').trim();
  return cleaned || undefined;
}

/** `og:image` / `twitter:image` — how most pages declare a poster. */
export function posterFromMeta(html: string): string | undefined {
  const raw =
    html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i)?.[1] ??
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i)?.[1];
  return normalizeImageUrl(raw ? decodeEntities(raw) : undefined);
}

/* ------------------------------------------------------------------ */
/* Bilibili-shaped part lists                                          */
/* ------------------------------------------------------------------ */

/**
 * The `pages[]` array Bilibili embeds in a watch page. The `x/web-interface/
 * view` API is the cleaner source, but it is WAF-gated and treating a refused
 * call as "this video has no parts" reads to the user as a single video — so
 * they download one part of many believing it is the whole thing. This is the
 * fallback that keeps a multi-part video honest.
 */
export function partsFromWatchPage(html: string): VideoPart[] | undefined {
  const marker = html.match(/"pages"\s*:\s*\[/);
  if (!marker || marker.index == null) return undefined;
  const json = sliceBalanced(html, marker.index + marker[0].length - 1);
  if (!json) return undefined;
  try {
    const pages = JSON.parse(json) as { page?: number; cid?: number; part?: string; duration?: number }[];
    const parts = pages
      .filter((page) => page.cid != null)
      .map((page, at) => ({
        index: page.page ?? at + 1,
        cid: String(page.cid),
        title: page.part?.trim() || `P${page.page ?? at + 1}`,
        durationSeconds: page.duration ?? 0,
      }));
    // One page is not a part list — it is simply the video.
    return parts.length > 1 ? parts : undefined;
  } catch {
    return undefined;
  }
}

/** The video's own title, from the page's `<h1 title="…">`. The page's
 *  `<title>` is the PART's name (「无字幕」), so it cannot stand in for it. */
export function titleFromWatchPage(html: string): string | undefined {
  const raw = html.match(/<h1[^>]*\btitle="([^"]+)"/i)?.[1];
  if (!raw) return undefined;
  return decodeEntities(raw).trim() || undefined;
}

/* ------------------------------------------------------------------ */
/* DASH tracks → format rows                                           */
/* ------------------------------------------------------------------ */

/** One DASH track as the playurl APIs describe it. Both spellings are
 *  accepted because Bilibili's endpoints disagree: the `x/player` API
 *  returns camelCase, PGC's returns `base_url`/`backup_url` as well. */
export interface DashEntry {
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  bandwidth?: number;
  width?: number;
  height?: number;
  id?: number;
  codecs?: string;
  /** Real byte count — PGC's playurl declares one; `x/player` does not. */
  size?: number;
}

export interface DashTracks {
  video?: DashEntry[];
  audio?: DashEntry[];
  /** Manifest duration in seconds: enables a size estimate when the
   *  response carries no per-track byte count. */
  duration?: number;
}

const urlOf = (entry?: DashEntry): string => entry?.baseUrl || entry?.base_url || '';
const mirrorsOf = (entry?: DashEntry): string[] => entry?.backupUrl ?? entry?.backup_url ?? [];

/**
 * Turn DASH representations into selectable rows.
 *
 * The product rule: never show the user a "video-only" track when a complete
 * file is possible. A video representation with an audio track available
 * becomes a `dash-mux` row (dashMux.ts merges the two into one MP4 on
 * download); separate tracks are emitted only when there is no audio to
 * pair with.
 *
 * `audio` controls the standalone audio row:
 *   - `'always'`   — the API path: an extraction the page blob cannot give
 *   - `'fallback'` — only when nothing else could carry sound, so a page
 *                    blob never re-lists an audio track the API already
 *                    offered
 */
export function dashEntriesToFormats(
  dash: DashTracks | undefined,
  options: { coveredHeight?: number; audio?: 'always' | 'fallback'; audioLabel?: string } = {},
): MediaFormatOption[] {
  const { coveredHeight = 0, audio: audioMode = 'fallback', audioLabel = '音频' } = options;
  // Same height, three codecs (avc1 / hev1 / av01) is the normal Bilibili
  // case. Rank H.264 first even when it declares the lower bitrate: the
  // merged file has to actually PLAY afterwards, and HEVC is not decodable
  // in every browser. Only then does bitrate decide.
  const prefersPlayable = (entry: DashEntry) => (/^avc/i.test(entry.codecs ?? '') ? 1 : 0);
  const videos = [...(dash?.video ?? [])].sort(
    (a, b) =>
      (b.height ?? 0) - (a.height ?? 0) ||
      prefersPlayable(b) - prefersPlayable(a) ||
      (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
  );
  const audio = [...(dash?.audio ?? [])].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];

  const seconds = typeof dash?.duration === 'number' && dash.duration > 0 ? dash.duration : 0;
  // Prefer the declared byte count; else bandwidth × duration.
  const bytes = (entry?: DashEntry) => {
    if (entry?.size) return entry.size;
    if (seconds && entry?.bandwidth) return Math.round((entry.bandwidth / 8) * seconds);
    return 0;
  };

  const out: MediaFormatOption[] = [];
  const seenHeights = new Set<number>();
  for (const video of videos) {
    const height = video.height ?? 0;
    if (!urlOf(video) || !height || height <= coveredHeight || seenHeights.has(height)) continue;
    seenHeights.add(height);
    const companion = urlOf(audio);
    out.push(
      companion
        ? {
            key: `dash-mux-${height}`,
            container: 'dash-mux',
            quality: `${height}p`,
            hasAudio: true,
            size: bytes(video) + bytes(audio),
            url: urlOf(video),
            backupUrls: mirrorsOf(video),
            requiresReferer: true,
            companionUrl: companion,
            companionBackupUrls: mirrorsOf(audio),
          }
        : {
            key: `dash-video-${height}`,
            container: 'dash-video',
            quality: `${height}p`,
            hasAudio: false,
            size: bytes(video),
            url: urlOf(video),
            backupUrls: mirrorsOf(video),
            requiresReferer: true,
          },
    );
  }

  const companion = urlOf(audio);
  if (companion && (audioMode === 'always' || out.length === 0)) {
    out.push({
      key: 'dash-audio',
      container: 'dash-audio',
      quality: audio?.bandwidth ? `${Math.round(audio.bandwidth / 1000)}kbps` : audioLabel,
      hasAudio: true,
      size: bytes(audio),
      url: companion,
      backupUrls: mirrorsOf(audio),
    });
  }
  return out;
}

/** Vertical resolution of a format label — '1080p' → 1080, 'MP4' → 0.
 *  Drives both the "best quality" ordering and the redundant-DASH filter. */
export function resolutionOf(format: MediaFormatOption): number {
  const match = format.quality.match(/^(\d+)p/i);
  return match ? Number(match[1]) : 0;
}
