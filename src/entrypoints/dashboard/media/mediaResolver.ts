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
import {
  dashEntriesToFormats,
  decodeEntities,
  embeddedJson,
  normalizeImageUrl,
  pageTitle,
  partsFromWatchPage,
  posterFromMeta,
  resolutionOf,
  titleFromWatchPage,
  type DashEntry,
  type DashTracks,
} from './pageHtml';
import { BUILT_IN_ADAPTERS, isYouTubePageUrl, type SiteAdapter } from './siteAdapters';
import { bestFailure, failureFromError, hostOf, type ResolveFailure } from './resolveFailure';

// Pure HTML readers that used to live here. Re-exported because they are
// part of this module's public surface (the tests read them) even though
// the site adapters are now their main consumer.
export { partsFromWatchPage, titleFromWatchPage } from './pageHtml';
// The extension installs a network rule scoped to YouTube resolves; it asks
// the adapter rather than repeating the host patterns.
export { isYouTubePageUrl };

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

/** One part of a multi-part video: a Bilibili 分P, or one episode of a
 *  番剧/课程 season. Both are "a piece of a larger thing that the user can
 *  resolve and download on its own", which is why they share a model. */
export interface VideoPart {
  /** 1-based position, as the site presents it. */
  index: number;
  cid: string;
  title: string;
  durationSeconds: number;
  /** Where to resolve THIS part. A Bilibili 分P is the same page with
   *  `?p=n`, but a PGC episode is its own URL — so an adapter that cannot
   *  express a part as a query parameter supplies one instead, and the
   *  batch downloader follows it. Absent ⇒ derive from the page URL. */
  url?: string;
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
  /** What this site calls its parts. A Bilibili video has 分P; a 番剧 season
   *  has episodes. The model is the same, the vocabulary is not — calling a
   *  TV episode "P2" is exactly the kind of detail that makes a tool feel
   *  machine-generated. Absent ⇒ 分P. */
  partsLabel?: 'parts' | 'episodes';
  /** Set when resolution only found DASH (no muxed option). */
  dashOnly: boolean;
  /** Site-specific explanation shown in the UI (i18n key suffix).
   *  `dash-only` — separate tracks, merged on download (still complete).
   *  `sd-only`   — only the pre-muxed standard-quality file is offered; the
   *                higher qualities exist but the site will not serve them.
   *  `empty`     — nothing downloadable was found at all (see `failure` for
   *                WHY, which is the part a user can act on). */
  notice: '' | 'dash-only' | 'sd-only' | 'empty';
  /** Why this resolve produced nothing usable. Absent ⇒ it worked. The reason
   *  is decided where the knowledge exists (fetcher / adapter / client) rather
   *  than reconstructed from a generic "could not resolve" string — see
   *  `resolveFailure.ts` for what went wrong the last time it was not. */
  failure?: ResolveFailure;
}

/** Options a fetcher may honor.
 *
 *  `mobile` — Douyin only serves its share-page data (the embedded
 *  `_ROUTER_DATA` video item) to mobile user agents.
 *
 *  The rest exist because not every site hands its data out over a plain
 *  GET: YouTube's player endpoint is POST-only and discriminated by request
 *  headers, so a caller has to be able to say "POST this JSON with these
 *  headers" rather than only "fetch this URL". A fetcher applies its own
 *  defaults first and `headers` last, so a site can override a caller's
 *  User-Agent when its API requires its own client identity. */
export interface FetchTextOptions {
  mobile?: boolean;
  method?: 'GET' | 'POST';
  /** Request body. Only meaningful with `method: 'POST'`. */
  body?: string;
  headers?: Record<string, string>;
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

/**
 * The complete dispatch order.
 *
 * Site-specific adapters first (most specific wins), then the generic HTML
 * scan as the floor — which is what makes the tool work on a site nobody
 * wrote an adapter for. The two original platforms are registered here
 * rather than in `siteAdapters.ts` because their chains share this module's
 * DASH helpers; adding a platform does NOT require editing this list, only
 * adding an adapter to the registry.
 */
const ADAPTERS: readonly SiteAdapter[] = [
  ...BUILT_IN_ADAPTERS,
  {
    id: 'bilibili',
    label: 'Bilibili 视频',
    example: 'https://www.bilibili.com/video/BV1RNYu6iEjB',
    match: (url) => BILIBILI_PAGE.test(url),
    resolve: ({ pageUrl, fetchText, report }) => resolveBilibili(pageUrl, fetchText, report),
  },
  {
    id: 'douyin',
    label: 'Douyin 抖音',
    example: 'https://v.douyin.com/iAbCdEf/',
    match: (url) => isDouyinUrl(url),
    resolve: ({ pageUrl, fetchText, report }) => resolveDouyin(pageUrl, fetchText, report),
  },
];

/** What the UI advertises as supported — derived from the dispatch order
 *  above, so the copy cannot drift from what actually resolves. */
export const SUPPORTED_PLATFORMS: readonly { id: string; label: string; example: string }[] = ADAPTERS.map(
  ({ id, label, example }) => ({ id, label, example }),
);

/**
 * Resolve a watch page into downloadable formats.
 *
 * Never throws for anything the caller could act on. A resolve that produces
 * nothing comes back as a `ResolvedPageAsset` carrying a `failure`, because a
 * thrown string is where the reason used to get lost: the panel could only
 * print one generic sentence, and it blamed the site for failures that were
 * ours (a mis-routed proxy, a wall clock).
 *
 * Adapters stay isolated — one that fails hands the turn to the next, and the
 * generic scan is the floor — but each one can `report()` WHY it failed, and
 * the most actionable report wins. */
export async function resolvePageUrl(
  pageUrl: string,
  fetchText: FetchText,
  fetchWithUrl?: FetchTextWithUrl,
): Promise<ResolvedPageAsset> {
  const reported: ResolveFailure[] = [];
  const report = (failure: ResolveFailure): void => {
    reported.push(failure);
  };
  try {
    const target = await canonicalizeShortLink(pageUrl, fetchWithUrl);
    for (const adapter of ADAPTERS) {
      if (!adapter.match(target)) continue;
      // An adapter that fails must not take the whole resolve down with it:
      // the next adapter (and finally the generic scan) still gets a turn —
      // but its reason is recorded first.
      const resolved = await adapter.resolve({ pageUrl: target, fetchText, report }).catch((err: unknown) => {
        report(failureFromError(err, target));
        return null;
      });
      if (resolved) return resolved;
    }
    const generic = await resolveGeneric(target, fetchText);
    if (generic.formats.length > 0) return generic;
    return { ...generic, failure: bestFailure(reported) ?? { reason: 'no-format', host: hostOf(target) } };
  } catch (err) {
    // A fetch that never got an answer — the floor threw.
    return failedResolveAsset(pageUrl, bestFailure(reported) ?? failureFromError(err, pageUrl));
  }
}

/** An empty result that carries only a reason — the shape every "it did not
 *  work" path returns, so the UI never has to reconstruct one from a string. */
export function failedResolveAsset(pageUrl: string, failure: ResolveFailure): ResolvedPageAsset {
  return {
    title: failure.host ?? pageUrl,
    pageUrl,
    formats: [],
    dashOnly: false,
    notice: 'empty',
    failure,
  };
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

/**
 * Bilibili's API envelope code → why it refused.
 *
 * These codes are the difference between "this video has no downloadable
 * formats" and "Bilibili's WAF banned this request": `-412 request was banned`
 * was measured repeatedly while chasing a blocked UA string, and treating it as
 * "found nothing" is exactly the silent degradation that cost every multi-part
 * video its part list once already.
 */
function bilibiliFailure(code: number, message: string | undefined, host: string): ResolveFailure {
  const detail = message?.trim() || `code ${code}`;
  if (code === -101 || code === -400) return { reason: 'login', host, detail };
  if (code === -404 || code === -10403) return { reason: 'unavailable', host, detail };
  return { reason: 'blocked', host, detail };
}

async function resolveBilibili(
  pageUrl: string,
  fetchText: FetchText,
  report: (failure: ResolveFailure) => void = () => undefined,
): Promise<ResolvedPageAsset | null> {
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
  const meta = await fetchVideoMeta(bvid, fetchText, report);
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
        code?: number;
        message?: string;
        data?: {
          quality?: number;
          durl?: { url?: string; backup_url?: string[]; size?: number }[];
          accept_quality?: number[];
        };
      };
      if (payload.code) report(bilibiliFailure(payload.code, payload.message, 'api.bilibili.com'));
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
    } catch (err) {
      // API refused (region/login wall) — the DASH fallback below still gives
      // tracks, but remember WHY in case nothing else works either.
      report(failureFromError(err, 'https://api.bilibili.com'));
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
  if (cid) formats.push(...(await fetchDashFormats(bvid, cid, fetchText, bestMuxed, report)));

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

/** Video metadata + part list from `x/web-interface/view`. Optional: when it
 *  refuses, the watch page's own title/cid still resolve a single part. */
async function fetchVideoMeta(
  bvid: string,
  fetchText: FetchText,
  report: (failure: ResolveFailure) => void = () => undefined,
): Promise<VideoMeta> {
  try {
    const payload = JSON.parse(
      await fetchText(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`),
    ) as {
      code?: number;
      message?: string;
      data?: {
        title?: string;
        pic?: string;
        pages?: { page?: number; cid?: number; part?: string; duration?: number }[];
      };
    };
    // The WAF's `-412` lands here. The page-HTML fallback below keeps the part
    // list either way, but the user should still be told the site pushed back
    // if the resolve ultimately produces nothing.
    if (payload.code) report(bilibiliFailure(payload.code, payload.message, 'api.bilibili.com'));
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

/** DASH playurl (`fnval=4048`). One merged row per quality above
 *  `coveredHeight`, plus the audio track as its own playable M4A — the
 *  audio-only extraction the page-embedded blob cannot provide. Sizes are
 *  estimated from the declared bandwidth × the manifest's own duration,
 *  because this endpoint declares no per-track byte count. */
async function fetchDashFormats(
  bvid: string,
  cid: string,
  fetchText: FetchText,
  coveredHeight: number,
  report: (failure: ResolveFailure) => void = () => undefined,
): Promise<MediaFormatOption[]> {
  const api =
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}` +
    '&platform=pc&fnval=4048&qn=127&fnver=0&fourk=1';
  try {
    const payload = JSON.parse(await fetchText(api)) as {
      code?: number;
      message?: string;
      data?: { dash?: { duration?: number; video?: DashEntry[]; audio?: DashEntry[] } };
    };
    if (payload.code) report(bilibiliFailure(payload.code, payload.message, 'api.bilibili.com'));
    return dashEntriesToFormats(payload.data?.dash, { coveredHeight, audio: 'always' });
  } catch (err) {
    report(failureFromError(err, 'https://api.bilibili.com'));
    return [];
  }
}

/** The two embedded play-info containers, normalized. `__playinfo__` hangs
 *  its manifest off `data`; PGC nests it one level deeper at
 *  `data.result`. */
interface PlayInfo {
  data?: { dash?: DashTracks; result?: { dash?: DashTracks } };
  result?: { dash?: DashTracks };
}

/** The DASH manifest a watch page embeds → format options.
 *
 *  Two containers to dig out of: `window.__playinfo__` on `/video/` pages,
 *  and `playurlSSRData` on PGC pages — the latter because the PGC page
 *  writes `window.__playinfo__ = playurlSSRData.data`, a *reference*, so the
 *  definition is the only thing actually parseable.
 *
 *  `pageUrl` stays in the signature deliberately: PGC's own payload carries
 *  no base URLs at all (they are minted client-side), so tracks without one
 *  are skipped rather than emitted as a guaranteed 404. */
function extractPlayinfoFormats(html: string, pageUrl: string, coveredHeight = 0): MediaFormatOption[] {
  // The *definition* is tried first: on PGC pages `window.__playinfo__` is
  // only an alias, and scanning after an alias would find whatever object
  // happens to follow it.
  const info =
    embeddedJson<PlayInfo>(html, 'playurlSSRData') ?? embeddedJson<PlayInfo>(html, '__playinfo__');
  if (!info) return [];
  const dash = info.data?.dash ?? info.data?.result?.dash ?? info.result?.dash;
  void pageUrl;
  // `fallback` audio: a page blob must not re-list the audio track the API
  // path already offered, so the standalone row appears only when no video
  // representation could carry sound.
  return dashEntriesToFormats(dash, { coveredHeight, audio: 'fallback' });
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
async function resolveDouyin(
  pageUrl: string,
  fetchText: FetchText,
  report: (failure: ResolveFailure) => void = () => undefined,
): Promise<ResolvedPageAsset | null> {
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

/** A URL that is a media FILE, not a player or embed page. Without this
 *  check, `og:video` (which frequently points at `/embed/xxxx`) would be
 *  offered as a downloadable "MP4" and 404 the user. */
const MEDIA_FILE = /\.(?:m3u8|mp4|m4a|mp3|webm|mov)(?:\?|#|$)/i;

/** `VideoObject` entries from schema.org JSON-LD, flattened. */
function jsonLdVideos(html: string): { name?: string; contentUrl?: string; thumbnail?: string }[] {
  const out: { name?: string; contentUrl?: string; thumbnail?: string }[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const type = record['@type'];
    const isVideo = Array.isArray(type)
      ? type.some((entry) => /videoobject/i.test(String(entry)))
      : typeof type === 'string' && /videoobject/i.test(type);
    if (isVideo) {
      out.push({
        name: typeof record.name === 'string' ? record.name : undefined,
        contentUrl: typeof record.contentUrl === 'string' ? record.contentUrl : undefined,
        thumbnail: typeof record.thumbnailUrl === 'string' ? record.thumbnailUrl : undefined,
      });
    }
    for (const value of Object.values(record)) walk(value);
  };
  for (const blob of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(blob[1]!));
    } catch {
      /* malformed structured data is common — skip that block only */
    }
  }
  return out;
}

/**
 * Direct media a page advertises, best source first.
 *
 * The ordering is the value here: a site that publishes proper structured
 * data should be read from that, not from a regex over its markup. The raw
 * scan is last because it is the one that picks up navigation and
 * thumbnails alongside the real stream.
 *
 * `.mpd` (a DASH manifest) is deliberately NOT collected: the engine has no
 * generic DASH muxer, so offering one would hand the user an XML file named
 * `video.mp4`. Better to report nothing than to ship a broken download.
 */
function directMediaFromHtml(html: string): { formats: MediaFormatOption[]; title?: string; cover?: string } {
  const found: { url: string; hls: boolean }[] = [];
  const seen = new Set<string>();
  const push = (raw?: string) => {
    if (!raw) return;
    const url = decodeEntities(raw).replace(/\\\//g, '/').trim();
    if (!/^https?:/i.test(url) || !MEDIA_FILE.test(url)) return;
    const id = assetIdFor(url);
    if (seen.has(id)) return;
    seen.add(id);
    found.push({ url, hls: /\.m3u8(\?|#|$)/i.test(url) });
  };

  let title: string | undefined;
  let cover: string | undefined;

  // 1. schema.org VideoObject — the source a publisher maintains on purpose.
  for (const video of jsonLdVideos(html)) {
    title ??= video.name?.trim() || undefined;
    cover ??= normalizeImageUrl(video.thumbnail);
    push(video.contentUrl);
  }

  // 2. The social card every CMS emits (both attribute orders occur).
  const OG_VIDEO = /(?:property|name)=["'](?:og:video(?::secure_url|:url)?|twitter:player:stream)["']/;
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (!OG_VIDEO.test(tag)) continue;
    push(tag.match(/content=["']([^"']+)["']/i)?.[1]);
  }

  // 3. A plain <video>/<source> element.
  for (const match of html.matchAll(/<(?:video|source)\b[^>]+src=["']([^"']+)["']/gi)) push(match[1]);

  // 4. Maccms/苹果CMS `player_aaaa` — the stock player config on thousands
  //    of Chinese video sites. Reading it is the difference between working
  //    on "any site" and working on the three we wrote adapters for.
  push(embeddedJson<{ url?: string }>(html, 'player_aaaa')?.url);

  // 5. Last resort: any absolute media URL in the markup.
  for (const match of html.matchAll(/https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4|webm|mov)(?:\?[^"'\\\s<>]*)?/gi)) {
    push(match[0]);
  }

  const formats: MediaFormatOption[] = found.map((item, at) => ({
    key: `${item.hls ? 'hls' : 'mp4'}-${at}`,
    container: item.hls ? 'hls' : 'mp4',
    quality: item.hls ? 'HLS' : 'MP4',
    hasAudio: true,
    size: 0,
    url: item.url,
    backupUrls: [],
  }));
  return { formats, title, cover };
}

/**
 * The floor of the dispatch order: a site nobody wrote an adapter for.
 *
 * Everything it finds is a direct URL the page itself published, so it
 * needs no per-site knowledge — which is what makes "paste any playback
 * page" a promise the tool can keep beyond the named platforms.
 */
async function resolveGeneric(pageUrl: string, fetchText: FetchText): Promise<ResolvedPageAsset> {
  const html = await fetchText(pageUrl);
  const media = directMediaFromHtml(html);
  const title = media.title ?? pageTitle(html) ?? safeHost(pageUrl);
  return {
    title,
    cover: media.cover,
    pageUrl,
    formats: media.formats,
    dashOnly: false,
    notice: media.formats.length === 0 ? 'empty' : '',
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
 *  eventually lands must still match the name shown while it queued.
 *
 *  `partTitle` is what the site calls the part (「为了消灭鬼舞辻无惨」, a
 *  番剧 episode name). A batch of a box set named only `P1…P12` is unusable
 *  in a file manager, so the name leads with the ordinal — which keeps the
 *  batch ordered — and then says what the part actually is. */
export function fileNameForPart(title: string, partIndex: number, partTitle?: string): string {
  const auto = `P${partIndex}`;
  const label = partTitle && partTitle.trim() && partTitle.trim() !== auto ? `${auto} ${partTitle.trim()}` : auto;
  const safe = sanitizeFileName(`${title} - ${label}`) || 'video';
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
 *  permissions ⇒ CORS-exempt) downloads directly.
 *
 *  googlevideo joined the list on measurement, not assumption: its response
 *  carries `Vary: Origin` and `Cross-Origin-Resource-Policy: cross-origin` but
 *  NO `Access-Control-Allow-Origin` (verified with a page Origin), so the
 *  muxed MP4 downloads fine in the extension and would fail outright from a
 *  web page. `ytimg` is here for the same reason on the .webp artwork (the
 *  .jpg variant does send `*`, the webp does not). */
const PROXIED_CDN = /(?:^|\.)(douyinvod\.com|zjcdn\.com|snssdk\.com|iesdouyin\.com|douyin\.com|googlevideo\.com|ytimg\.com)$/i;

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
