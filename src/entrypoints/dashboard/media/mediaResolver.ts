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
  /** Stable key for React lists: `mp4-64` / `dash-mux-1080` … */
  key: string;
  /** Label chip: "MP4 · 720p · 有声音" style, built by the UI from parts.
   *  `dash-mux` renders exactly like `mp4` — it IS a complete MP4 once the
   *  two tracks are merged on the fly. */
  container: 'mp4' | 'hls' | 'dash-video' | 'dash-audio' | 'dash-mux' | 'file';
  quality: string;
  /** The muxed file carries its own audio track. */
  hasAudio: boolean;
  /** Byte size when the source declared one (0 = unknown). */
  size: number;
  /** URL to download for this format. */
  url: string;
  /** Alternate CDN mirrors tried in order on failure. */
  backupUrls: string[];
  /** DASH pair: the audio track URL (primary + mirrors). */
  companionUrl?: string;
  companionBackupUrls?: string[];
  /** Hotlink-gated track. Bilibili serves the DASH *video* track only when
   *  the Referer is a bilibili origin (verified: 403 foreign/absent, 206
   *  own) and no page can set that header — so web builds route these
   *  through the same-origin proxy and the extension relies on its
   *  declarativeNetRequest rule. The muxed MP4 and the audio track are open
   *  and must NOT pay for the proxy. */
  requiresReferer?: boolean;
}

/** One part of a multi-part video (Bilibili 分P). */
export interface VideoPart {
  /** 1-based position, as the site presents it. */
  index: number;
  cid: string;
  title: string;
  durationSeconds: number;
}

/** A resolved page: one row per logical stream, each with its formats. */
export interface ResolvedPageAsset {
  title: string;
  pageUrl: string;
  /** Poster image for the UI's hero card (best effort — absent = initials). */
  cover?: string;
  formats: MediaFormatOption[];
  /** Present only for a genuinely multi-part video — a resolver that
   *  returned formats for the first part while staying silent about the
   *  rest handed the user half a video with no way to tell. */
  parts?: VideoPart[];
  /** Which part the formats above belong to (1-based). Without it the card
   *  shows a part list and a format ladder with nothing tying them together,
   *  which is how a user ends up downloading P2 believing it is P1. */
  partIndex?: number;
  /** Set when resolution only found DASH (no muxed option). */
  dashOnly: boolean;
  /** Site-specific explanation shown in the UI (i18n key suffix). */
  notice: '' | 'dash-only' | 'empty';
}

/** Options a fetcher may honor — Douyin only serves its share-page data
 *  (the embedded `_ROUTER_DATA` video item) to mobile user agents. */
export interface FetchTextOptions {
  mobile?: boolean;
}

/** Minimal fetch signature so tests can stub network. Callers may ignore
 *  the options argument (older fetchers do — that stays type-compatible). */
export type FetchText = (url: string, options?: FetchTextOptions) => Promise<string>;

/** Fetcher that also reports the post-redirect URL. Needed for short links:
 *  Bilibili's mobile share sheet hands out `b23.tv/xxxx` codes whose only
 *  canonical form lives in the redirect target. The two surfaces that own
 *  real network access (the extension service worker, the web build's
 *  server core) pass one of these alongside the plain fetcher; everything
 *  else — including every existing test — keeps the 2-arg signature. */
export type FetchTextWithUrl = (url: string, options?: FetchTextOptions) => Promise<{ text: string; finalUrl: string }>;

/** Bilibili's share shortener. `bili2233.cn` is the newer one. */
const SHORT_LINK = /^https?:\/\/(?:b23\.tv|bili2233\.cn)\//i;

/** Pull the first URL out of arbitrary pasted text — the Bilibili app's
 *  share sheet produces 「【标题】 https://b23.tv/xxxx」, and users paste the
 *  whole thing. Trailing CJK punctuation is trimmed, not kept. */
export function extractUrlFromText(text: string): string {
  const match = text.match(/https?:\/\/[^\s"'<>】）)]+/i);
  if (!match) return text.trim();
  return match[0].replace(/[，。、；：！？,.;:!?]+$/, '');
}

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

export async function resolvePageUrl(
  pageUrl: string,
  fetchText: FetchText,
  fetchWithUrl?: FetchTextWithUrl,
): Promise<ResolvedPageAsset> {
  const target = await canonicalizeShortLink(pageUrl, fetchWithUrl);
  if (isDouyinUrl(target)) {
    const douyin = await resolveDouyin(target, fetchText).catch(() => null);
    if (douyin) return douyin;
  }
  if (BILIBILI_PAGE.test(target)) {
    const bili = await resolveBilibili(target, fetchText).catch(() => null);
    if (bili) return bili;
  }
  return resolveGeneric(target, fetchText);
}

/** Follow a share shortener to its canonical watch page. Without a
 *  redirect-reporting fetcher the short URL is resolved as-is (the generic
 *  path), which is the old — usually fruitless — behaviour. */
async function canonicalizeShortLink(pageUrl: string, fetchWithUrl?: FetchTextWithUrl): Promise<string> {
  if (!SHORT_LINK.test(pageUrl) || !fetchWithUrl) return pageUrl;
  try {
    const { finalUrl } = await fetchWithUrl(pageUrl);
    return /^https?:/i.test(finalUrl) ? finalUrl : pageUrl;
  } catch {
    return pageUrl;
  }
}

async function resolveBilibili(pageUrl: string, fetchText: FetchText): Promise<ResolvedPageAsset | null> {
  const bvid = pageUrl.match(BILIBILI_PAGE)?.[1];
  if (!bvid) return null;

  // 1. Watch page. It carries the SELECTED part's cid — `?p=2` really does
  //    serve part 2 — which is what makes per-part resolution free.
  const html = await fetchText(pageUrl);
  const cid = html.match(/"cid":(\d+)/)?.[1] ?? html.match(/cid=(\d+)/)?.[1] ?? '';

  // 2. Metadata + the part list. The page's own <title> is the PART's name
  //    (「无字幕」), not the video's, so the real title comes from the API.
  //    When that API refuses — it sits behind a WAF that blocks on a whim,
  //    and a single blocked UA string silently cost every multi-part video
  //    its part list — fall back to the page we already fetched, which
  //    embeds the same array plus the real title in an <h1>. Never let a
  //    refused metadata call downgrade "download the video" into "download
  //    one twelfth of it, with no indication".
  const meta = await fetchVideoMeta(bvid, fetchText);
  const parts = meta.parts ?? partsFromWatchPage(html);
  const title =
    meta.title ??
    titleFromWatchPage(html) ??
    html.match(/<title[^>]*>([^<]+)/)?.[1]?.trim().replace(/_哔哩哔哩.*$/, '') ??
    bvid;
  // Poster: the API's own field when we have it, else the share-card image
  // the watch page embeds (decode its HTML entities — covers carry &amp;).
  const cover = meta.cover ?? normalizeImageUrl(html.match(/property="og:image" content="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&'));

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

  // 3. DASH playurl API — strictly more capable than scraping the page: it
  //    carries the audio track (the audio-only download) and, for a session
  //    the page's html5 API will not upgrade, the higher qualities. Anonymous
  //    callers are granted up to 480p plus three audio tracks; the extension
  //    service worker fetches with credentials, so a logged-in bilibili.com
  //    session is granted 1080p here. Heights the html5 API already delivered
  //    as complete muxed files are deliberately skipped — a 480p merged row
  //    under an existing 720p MP4 is clutter, not choice.
  const bestMuxed = Math.max(0, ...formats.map((format) => resolutionOf(format)));
  if (cid) formats.push(...(await fetchDashFormats(bvid, cid, fetchText, bestMuxed)));

  // 4. Page-embedded playinfo as a last resort — covers layouts where both
  //    APIs refused and the blob is all there is. Same height filter as the
  //    API path, or a variant page's blob re-adds merged 480p/360p rows
  //    underneath an MP4 that is already better.
  if (!formats.some((format) => format.container === 'dash-mux' || format.container === 'dash-video')) {
    const hasAudio = formats.some((format) => format.container === 'dash-audio');
    formats.push(
      ...extractPlayinfoFormats(html, pageUrl, bestMuxed).filter(
        // The API path already offered the audio track — do not list a second.
        (format) => format.container !== 'dash-audio' || !hasAudio,
      ),
    );
  }

  const deduped = dedupeFormats(formats);
  // dash-mux rows ARE complete files (video+audio merged on download).
  const complete = deduped.filter((f) => f.container === 'mp4' || f.container === 'dash-mux');
  return {
    title,
    cover,
    pageUrl,
    formats: deduped,
    parts,
    // Only meaningful alongside a part list — the ladder belongs to the part
    // in the URL's `?p=`, which is the one the page actually served.
    partIndex: parts ? requestedPart(pageUrl) : undefined,
    dashOnly: complete.length === 0 && deduped.length > 0,
    notice: deduped.length === 0 ? 'empty' : complete.length === 0 ? 'dash-only' : '',
  };
}

/** Point a watch URL at another part. Same page, different `cid` — which is
 *  why a part can be resolved and downloaded with no new endpoint. */
export function withPartParam(pageUrl: string, index: number): string {
  try {
    const url = new URL(pageUrl);
    url.searchParams.set('p', String(index));
    return url.toString();
  } catch {
    return pageUrl;
  }
}

/** The 1-based part a watch URL asks for. Bilibili serves `?p=n` the same
 *  page with a different `cid`, so this is not cosmetic — it is the only
 *  thing distinguishing 「这是第几P的格式」. */
export function requestedPart(pageUrl: string): number {
  try {
    const part = Number(new URL(pageUrl).searchParams.get('p'));
    return Number.isFinite(part) && part >= 1 ? Math.floor(part) : 1;
  } catch {
    return 1;
  }
}

interface VideoMeta {
  title?: string;
  cover?: string;
  parts?: VideoPart[];
}

/** Read a JSON array starting at `open` (the index of its `[`), tracking
 *  nesting so an object inside it cannot end the scan early. Bracket
 *  counting rather than a regex because the entries are real objects with
 *  nested objects in them, and a lazy `\[.*?\]` stops at the wrong one. */
function sliceJsonArray(text: string, open: number): string | null {
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
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(open, at + 1);
    }
  }
  return null;
}

/** The part list Bilibili embeds in the watch page. The `x/web-interface/
 *  view` API is the cleaner source, but it is WAF-gated and treated the
 *  answer as "this video has no parts" whenever it refused — which reads to
 *  the user as a single video, so they download one part of many believing
 *  it is the whole thing. Export for tests. */
export function partsFromWatchPage(html: string): VideoPart[] | undefined {
  const marker = html.match(/"pages"\s*:\s*\[/);
  if (!marker || marker.index == null) return undefined;
  const json = sliceJsonArray(html, marker.index + marker[0].length - 1);
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

/** The video's own title, from the page's <h1 title="…">. The page's
 *  <title> is the PART's name (「无字幕」), so it cannot stand in for this. */
export function titleFromWatchPage(html: string): string | undefined {
  const raw = html.match(/<h1[^>]*\btitle="([^"]+)"/i)?.[1];
  if (!raw) return undefined;
  return decodeEntities(raw).trim() || undefined;
}

/** HTML entities that appear in Bilibili titles and attributes. */
function decodeEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

/** Video metadata + part list from `x/web-interface/view`. Optional: when it
 *  refuses, the watch page's own title/cid still resolve a single part. */
async function fetchVideoMeta(bvid: string, fetchText: FetchText): Promise<VideoMeta> {
  try {
    const payload = JSON.parse(
      await fetchText(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`),
    ) as {
      data?: {
        title?: string;
        pic?: string;
        pages?: { page?: number; cid?: number; part?: string; duration?: number }[];
      };
    };
    const data = payload.data;
    if (!data) return {};
    const pages = (data.pages ?? []).filter((page) => page.cid != null);
    return {
      title: data.title?.trim() || undefined,
      cover: normalizeImageUrl(data.pic),
      // One page is not a part list — it is simply the video.
      parts:
        pages.length > 1
          ? pages.map((page, at) => ({
              index: page.page ?? at + 1,
              cid: String(page.cid),
              title: page.part?.trim() || `P${page.page ?? at + 1}`,
              durationSeconds: page.duration ?? 0,
            }))
          : undefined,
    };
  } catch {
    return {};
  }
}

/** Covers arrive protocol-relative or over plain http; downloads need https. */
function normalizeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  return url.replace(/^http:\/\//i, 'https://');
}

/** One DASH track as Bilibili's playurl payload describes it. */
interface DashEntry {
  baseUrl?: string;
  backupUrl?: string[];
  bandwidth?: number;
  width?: number;
  height?: number;
  id?: number;
  codecs?: string;
}

/** Vertical resolution of a format label — '1080p' → 1080, 'MP4' → 0.
 *  Drives both the "best quality" ordering and the redundant-dash filter. */
function resolutionOf(format: MediaFormatOption): number {
  const match = format.quality.match(/^(\d+)p/i);
  return match ? Number(match[1]) : 0;
}

/** DASH playurl (`fnval=4048`). Returns one merged row per quality above
 *  `coveredHeight`, plus the audio track as its own playable M4A — the
 *  audio-only extraction the page-embedded blob cannot provide. Sizes are
 *  estimated from the declared bandwidth × the manifest's own duration
 *  (the DASH response has no per-track byte count). */
async function fetchDashFormats(
  bvid: string,
  cid: string,
  fetchText: FetchText,
  coveredHeight: number,
): Promise<MediaFormatOption[]> {
  const api =
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}` +
    '&platform=pc&fnval=4048&qn=127&fnver=0&fourk=1';
  let dash: { duration?: number; video?: DashEntry[]; audio?: DashEntry[] } | undefined;
  try {
    const payload = JSON.parse(await fetchText(api)) as {
      data?: { dash?: { duration?: number; video?: DashEntry[]; audio?: DashEntry[] } };
    };
    dash = payload.data?.dash;
  } catch {
    return [];
  }
  if (!dash?.video?.length) return [];

  const seconds = typeof dash.duration === 'number' && dash.duration > 0 ? dash.duration : 0;
  const estimate = (bandwidth?: number) => (seconds && bandwidth ? Math.round((bandwidth / 8) * seconds) : 0);
  const audio = [...(dash.audio ?? [])].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];

  const out: MediaFormatOption[] = [];
  const seen = new Set<number>();
  const videos = [...dash.video].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
  );
  for (const video of videos) {
    const height = video.height ?? 0;
    if (!video.baseUrl || !height || height <= coveredHeight || seen.has(height)) continue;
    seen.add(height);
    out.push(
      audio?.baseUrl
        ? {
            key: `dash-mux-${height}`,
            container: 'dash-mux',
            quality: `${height}p`,
            hasAudio: true,
            size: estimate(video.bandwidth) + estimate(audio.bandwidth),
            url: video.baseUrl,
            backupUrls: video.backupUrl ?? [],
            requiresReferer: true,
            companionUrl: audio.baseUrl,
            companionBackupUrls: audio.backupUrl ?? [],
          }
        : {
            key: `dash-video-${height}`,
            container: 'dash-video',
            quality: `${height}p`,
            hasAudio: false,
            size: estimate(video.bandwidth),
            url: video.baseUrl,
            backupUrls: video.backupUrl ?? [],
            requiresReferer: true,
          },
    );
  }

  // The audio track is a complete, playable M4A on its own — offer it even
  // when every video quality is already covered above.
  if (audio?.baseUrl) {
    out.push({
      key: 'bili-audio',
      container: 'dash-audio',
      quality: audio.bandwidth ? `${Math.round(audio.bandwidth / 1000)}kbps` : '',
      hasAudio: true,
      size: estimate(audio.bandwidth),
      url: audio.baseUrl,
      backupUrls: audio.backupUrl ?? [],
    });
  }
  return out;
}

/** `window.__playinfo__` → format options. Prefer ONE complete file per
 *  quality: DASH pairs become `dash-mux` rows (video+audio merged into a
 *  single MP4 at download time by dashMux.ts) so the user never sees
 *  "video-only" tracks that need extra software. Separate tracks are
 *  emitted only when no audio exists to pair with. */
function extractPlayinfoFormats(html: string, pageUrl: string, coveredHeight = 0): MediaFormatOption[] {
  const match = html.match(/window\.__playinfo__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i);
  if (!match?.[1]) return [];
  let info: { data?: { dash?: { video?: DashEntry[]; audio?: DashEntry[] } } };
  try {
    info = JSON.parse(match[1]);
  } catch {
    return [];
  }
  const dash = info.data?.dash;
  const videos = [...(dash?.video ?? [])].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
  );
  const audios = [...(dash?.audio ?? [])].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0));
  const audio = audios[0];
  const out: MediaFormatOption[] = [];
  const seenHeights = new Set<number>();
  for (const video of videos) {
    if (!video.baseUrl || !video.height || seenHeights.has(video.height)) continue;
    seenHeights.add(video.height);
    // A muxed MP4 at this height or better already covers the user.
    if (video.height <= coveredHeight) continue;
    if (audio?.baseUrl) {
      out.push({
        key: `dash-mux-${video.height}`,
        container: 'dash-mux',
        quality: `${video.height}p`,
        hasAudio: true,
        size: 0,
        url: video.baseUrl,
        backupUrls: video.backupUrl ?? [],
        requiresReferer: true,
        companionUrl: audio.baseUrl,
        companionBackupUrls: audio.backupUrl ?? [],
      });
    } else {
      out.push({
        key: `dash-video-${video.height}`,
        container: 'dash-video',
        quality: `${video.height}p`,
        hasAudio: false,
        size: 0,
        url: video.baseUrl,
        backupUrls: video.backupUrl ?? [],
        requiresReferer: true,
      });
    }
  }
  // Bare audio only when nothing could carry it in a complete file.
  if (!out.length && audio?.baseUrl) {
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
/* Douyin                                                              */
/* ------------------------------------------------------------------ */

/** douyin.com / iesdouyin.com hostnames (v.douyin.com short links too). */
const DOUYIN_HOST = /(?:^|\.)douyin\.com$|(?:^|\.)iesdouyin\.com$/i;

/** Numeric aweme id from a canonical URL, share URL, or `?modal_id=`. */
const DOUYIN_ID = /\/(?:share\/)?video\/(\d{15,21})/;

/** True when the extension SW should route this resolve through the
 *  mobile-UA session rule (exported for background.ts). */
export function isDouyinPageUrl(url: string): boolean {
  return isDouyinUrl(url);
}

/** The mobile share host — it serves `_ROUTER_DATA` with the video item
 *  without login or signatures. Desktop douyin.com requires signed XHRs. */
const DOUYIN_MOBILE_BASE = 'https://www.iesdouyin.com';

function isDouyinUrl(url: string): boolean {
  try {
    return DOUYIN_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

interface DouyinVideoItem {
  desc?: string;
  video?: {
    play_addr?: { uri?: string; url_list?: string[] };
    cover?: { url_list?: string[] };
  };
}

/**
 * Douyin chain (verified live against the real share page):
 *   1. GET the share page with a MOBILE UA. First visit gets a `ttwid`
 *      Set-Cookie and usually an empty `item_list`; the cookie jar of the
 *      caller (server fetcher, service worker) now holds ttwid.
 *   2. GET again (same URL, canonicalized to the share host) — this pass
 *      carries ttwid and embeds the full item incl. `play_addr.uri`.
 *   3. Build the no-watermark URL: the share page hands out `…/playwm/`
 *      (watermarked); swapping the endpoint to `…/play/` with the same
 *      `video_id` 302s to a freshly signed, watermark-free douyinvod MP4.
 *      Because the signature is minted per request, these URLs never
 *      expire — unlike Bilibili's pre-signed CDN links.
 */
async function resolveDouyin(pageUrl: string, fetchText: FetchText): Promise<ResolvedPageAsset | null> {
  // Canonicalize: the share page serves everything (desktop douyin.com
  // needs signed XHRs; v.douyin.com short codes redirect JS-side). Any
  // numeric id we can find gets us there.
  let id = pageUrl.match(DOUYIN_ID)?.[1] ?? pageUrl.match(/modal_id=(\d{15,21})/)?.[1] ?? '';
  const shareUrl = (wid: string) => `${DOUYIN_MOBILE_BASE}/share/video/${wid}`;

  let html = await fetchText(id ? shareUrl(id) : pageUrl, { mobile: true });
  let item = douyinItemFromHtml(html);
  if (!item && !id) {
    // Short links: the redirected landing HTML names the canonical id.
    id = html.match(/\/(?:share\/)?video\/(\d{15,21})/)?.[1] ?? '';
    if (id) {
      html = await fetchText(shareUrl(id), { mobile: true });
      item = douyinItemFromHtml(html);
    }
  }
  if (!item && id) {
    // Second pass: pass 1 delivered the ttwid Set-Cookie (via the caller's
    // cookie handling); the same URL now embeds the item.
    html = await fetchText(shareUrl(id), { mobile: true });
    item = douyinItemFromHtml(html);
  }
  if (!item && id) {
    // Third pass, spaced: Douyin intermittently serves the empty shell to
    // IPs it is throttling; a short pause clears the transient case.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    html = await fetchText(shareUrl(id), { mobile: true });
    item = douyinItemFromHtml(html);
  }
  if (!item) return null; // fall through to the generic HTML scan

  const uri = item.video?.play_addr?.uri ?? '';
  if (!uri) return null;
  const ratio = item.video?.play_addr?.url_list?.[0]?.match(/ratio=(\w+)/)?.[1] ?? '720p';
  const title = item.desc?.trim().slice(0, 120) || 'douyin';
  const cover: string | undefined = item.video?.cover?.url_list?.find((u: string) => /^https?:/.test(u));

  const playUrl = (endpoint: 'play' | 'playwm', line: number) =>
    `${DOUYIN_MOBILE_BASE}/aweme/v1/${endpoint}/?video_id=${encodeURIComponent(uri)}&ratio=${ratio}&line=${line}`;

  const formats: MediaFormatOption[] = [
    {
      key: 'douyin-mp4',
      container: 'mp4',
      quality: 'MP4',
      hasAudio: true,
      size: 0,
      url: playUrl('play', 0), // primary: watermark-free
      backupUrls: [playUrl('play', 1), playUrl('playwm', 0)], // alt CDN line, then watermarked
    },
  ];
  return { title, cover, pageUrl, formats, dashOnly: false, notice: '' };
}

/** Extract the first aweme item from a share page's `_ROUTER_DATA` blob. */
function douyinItemFromHtml(html: string): DouyinVideoItem | null {
  const match = html.match(/_ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!match?.[1]) return null;
  try {
    const data = JSON.parse(match[1]) as {
      loaderData?: Record<string, { videoInfoRes?: { item_list?: DouyinVideoItem[] } }>;
    };
    for (const page of Object.values(data.loaderData ?? {})) {
      const item = page?.videoInfoRes?.item_list?.[0];
      if (item) return item;
    }
  } catch {
    /* malformed router data — treat as absent */
  }
  return null;
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
  // Complete files first — that is the product's promise — then the bare
  // tracks. Within a group the best quality leads: the UI recommends the
  // first complete entry, so a 360p MP4 must never outrank a 1080p merged
  // pair just because it arrived first or comes in a simpler container.
  const group = (container: MediaFormatOption['container']) =>
    container === 'mp4' || container === 'dash-mux' || container === 'hls' || container === 'file' ? 0 : 1;
  return [...out.values()].sort(
    (a, b) =>
      group(a.container) - group(b.container) ||
      resolutionOf(b) - resolutionOf(a) ||
      (b.size || 0) - (a.size || 0),
  );
}

export function fileNameForFormat(title: string, format: MediaFormatOption, label?: string): string {
  // Parts of one video share its title, so a batch would collide: the part
  // label is what keeps 「合集 - P3 第三章」 distinct from 「合集 - P4」.
  const safe = sanitizeFileName(label ? `${title} - ${label}` : title) || 'video';
  const ext = format.container === 'hls' ? 'ts' : format.container === 'dash-audio' ? 'm4a' : 'mp4';
  // Separate tracks get a suffix so a video-only track can never be mistaken
  // for the complete file the user actually wanted.
  const suffix =
    format.container === 'dash-video' ? `-${format.quality}-video` : format.container === 'dash-audio' ? '-audio' : '';
  return `${safe}${suffix}.${ext}`;
}

/** Filename for one part of a multi-part batch. Exists separately so the
 *  batch can name its rows BEFORE the part is resolved — the file that
 *  eventually lands must still match the name shown while it queued. */
export function fileNameForPart(title: string, partIndex: number): string {
  const safe = sanitizeFileName(`${title} - P${partIndex}`) || 'video';
  return `${safe}.mp4`;
}

/** Choose the format a user already picked elsewhere — the same resolution
 *  on another part of a multi-part video. Falls back to the best complete
 *  file, so a part that lacks the exact quality still downloads. */
export function preferredFormat(
  formats: MediaFormatOption[],
  preference?: { quality?: string; container?: MediaFormatOption['container'] },
): MediaFormatOption | undefined {
  if (!preference?.quality && !preference?.container) return formats[0];
  const sameQuality = preference.quality
    ? formats.find((format) => format.quality === preference.quality && (!preference.container || format.container === preference.container))
    : undefined;
  if (sameQuality) return sameQuality;
  if (preference.container) return formats.find((format) => format.container === preference.container) ?? formats[0];
  return formats[0];
}

/** File name for the poster/cover download. */
export function fileNameForCover(title: string): string {
  return `${sanitizeFileName(title) || 'video'}-cover.jpg`;
}

/** Bilibili serves covers through an on-the-fly image processor
 *  (`….jpg@1200w_630h`). The card wants that share-sized crop, but a
 *  download wants the original, full-resolution artwork. */
export function originalImageUrl(url: string): string {
  return url.replace(/(\.(?:jpe?g|png|webp|gif|avif))@[^/]*$/i, '$1');
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').slice(0, 80).trim();
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Web-build proxy routing                                             */
/* ------------------------------------------------------------------ */

/** CDN hosts whose bytes come without CORS headers (verified: douyinvod
 *  sends no Access-Control-Allow-Origin, so a web page cannot read the
 *  stream). The web build fetches these through our same-origin
 *  `/api/resolve?proxyUrl=…` streaming proxy; the extension (host
 *  permissions ⇒ CORS-exempt) downloads directly. */
const PROXIED_CDN = /(?:^|\.)(douyinvod\.com|zjcdn\.com|snssdk\.com|iesdouyin\.com|douyin\.com)$/i;

/** Bilibili's media CDNs. Only the DASH *video* track is Referer-gated, so
 *  these host through the proxy on demand (`requiresReferer`) rather than
 *  unconditionally — the muxed MP4 and the audio track are open and should
 *  never spend the server's bandwidth. */
const BILI_CDN = /(?:^|\.)(bilivideo\.com|bilivideo\.cn|akamaized\.net)$/i;

/** Map a format URL to what the current context can actually fetch. */
export function fetchableUrl(url: string, extensionMode: boolean, requiresReferer = false): string {
  if (extensionMode) return url;
  try {
    const host = new URL(url).hostname;
    if (PROXIED_CDN.test(host) || (requiresReferer && BILI_CDN.test(host))) {
      return `/api/resolve?proxyUrl=${encodeURIComponent(url)}`;
    }
  } catch {
    /* keep the original on parse failure */
  }
  return url;
}
