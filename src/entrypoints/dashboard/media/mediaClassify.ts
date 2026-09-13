/**
 * Pure classification of network traffic into media assets.
 *
 * Runs in two places on purpose: the background sniffer classifies every
 * webRequest event (cheap, per-URL heuristics), and the web build's
 * paste-URL box runs the identical pipeline so both surfaces agree on
 * what a "media asset" is.
 *
 * Heuristic layers, in priority order:
 *   1. URL pattern  — .m3u8 / .mpd / .mp4 / segment suffixes etc.
 *   2. Content-type — authoritative when the sniffer saw response headers
 *                     (some CDNs serve .php URLs that are really video).
 *   3. Fallback     — binary image types only; anything else is ignored.
 */

import type { MediaAsset, MediaContainer, MediaEncryption, MediaKind } from './mediaTypes';

export const IGNORED_EXTENSIONS = /\.(css|js|mjs|html?|txt|xml|json|woff2?|ttf|otf|eot|svg|ico)(\?|$)/i;

const URL_KIND: [RegExp, MediaKind, MediaContainer][] = [
  [/\.(m3u8)(\?|$)/i, 'stream', 'hls'],
  [/\.(mpd)(\?|$)/i, 'stream', 'dash'],
  [/\.(mp4|m4v|mov|webm|mkv|flv|ts|m4s)(\?|$)/i, 'video', 'file'],
  [/\.(mp3|m4a|aac|ogg|opus|wav|flac)(\?|$)/i, 'audio', 'file'],
  [/\.(vtt|srt|ass)(\?|$)/i, 'subtitle', 'file'],
  [/\.(jpe?g|png|gif|webp|avif|bmp)(\?|$)/i, 'image', 'file'],
];

const CT_KIND: [RegExp, MediaKind, MediaContainer][] = [
  [/mpegurl/i, 'stream', 'hls'],
  [/dash\+xml/i, 'stream', 'dash'],
  [/(video|mp2t|mp4|mov|webm|matroska)/i, 'video', 'file'],
  [/(audio|mpeg|aac|ogg|opus|wav|flac)/i, 'audio', 'file'],
  [/(vtt|subtitle)/i, 'subtitle', 'file'],
  [/^image\//i, 'image', 'file'],
  [/octet-stream/i, 'other', 'file'],
];

/** Encryption hints picked out of the URL itself (rare, but free). */
function encryptionFromUrl(url: string): MediaEncryption | null {
  if (/skd:\/\//i.test(url)) return 'drm';
  if (/\.(m3u8|mpd)(\?|$)/i.test(url)) return 'unknown';
  return null;
}

export interface ClassifyInput {
  url: string;
  method?: string;
  contentType?: string;
  contentLength?: number | null;
  requestHeaders?: [string, string][];
  pageUrl?: string;
  live?: boolean;
  now?: number;
}

/** Classify one observed request. Returns null when it is not media. */
export function classifyRequest(input: ClassifyInput): Omit<MediaAsset, 'id' | 'firstSeenAt' | 'lastSeenAt' | 'hits'> | null {
  const url = input.url ?? '';
  // skd:// is a DRM key announcement — classified (so the UI can explain
  // "this stream is DRM-protected") rather than silently dropped.
  if (!/^https?:\/\//i.test(url) && !/^skd:\/\//i.test(url)) return null;
  if (input.contentType && /^(text\/html|text\/plain|application\/x-www-form-urlencoded)/i.test(input.contentType)) {
    // Almost certainly a document — but keep going, type lies happen.
  }

  let kind: MediaKind | null = null;
  let container: MediaContainer | null = null;

  for (const [re, k, c] of URL_KIND) {
    if (re.test(url)) {
      kind = k;
      container = c;
      break;
    }
  }

  if (!kind && input.contentType) {
    for (const [re, k, c] of CT_KIND) {
      if (re.test(input.contentType)) {
        kind = k;
        container = c;
        break;
      }
    }
  }

  // DRM key announcements carry no media pattern — surface them as
  // informational entries so the UI can label the parent stream DRM'd.
  if (!kind && /^skd:\/\//i.test(url)) {
    kind = 'other';
    container = 'file';
  }

  // Segment heuristics: HLS media playlists reference .ts/.m4s without
  // extensions sometimes; query-string-only URLs with long tokens that the
  // sniffer saw receiving video/* are already covered above. Without a
  // content-type, an extensionless URL is not confidently media.
  if (!kind || !container) return null;
  if (kind === 'image' && input.live !== false && !input.contentType) {
    // Images are noise in a video-focused sniffer unless the user pasted
    // them deliberately (web paste-URL sets live=false). Keep them only
    // when explicitly requested.
    return null;
  }
  if (IGNORED_EXTENSIONS.test(url)) return null;

  const contentType = input.contentType ?? '';
  let encryption: MediaEncryption = encryptionFromUrl(url) ?? 'none';
  if (container === 'dash' && encryption === 'none') encryption = 'unknown';
  if (container === 'hls' && encryption === 'none') encryption = 'unknown';
  if (/content-encryption|drm/i.test(contentType)) encryption = 'drm';

  return {
    kind,
    container,
    url,
    method: input.method ?? 'GET',
    contentType,
    size: input.contentLength ?? null,
    fileName: fileNameFromUrl(url, kind, container),
    encryption,
    requestHeaders: input.requestHeaders ?? [],
    live: input.live ?? true,
    pageUrl: input.pageUrl ?? '',
  };
}

/** Stable asset identity: same URL = same asset (hits increment). */
export function assetIdFor(url: string): string {
  // Trim volatile cache-busters so repeat plays dedupe, but keep
  // authenticated query params — they are part of the replayable identity.
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      // Cache-busters only — auth params (token/sign/expires) stay: they
      // are the replayable identity. Deduping across fresh tokens would
      // produce assets that 404 on download.
      if (/^(r|t|_|\d+|rand|random|timestamp|nonce|cb|cachebuster)$/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

export function fileNameFromUrl(url: string, kind: MediaKind, container: MediaContainer): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last);
    // Derive from the host for extensionless CDN URLs.
    const base = parsed.hostname.replace(/^www\./, '');
    const ext = container === 'hls' ? 'm3u8' : container === 'dash' ? 'mpd' : kind === 'audio' ? 'mp3' : kind === 'subtitle' ? 'vtt' : 'mp4';
    return `${base}.${ext}`;
  } catch {
    return `media-${kind}`;
  }
}
