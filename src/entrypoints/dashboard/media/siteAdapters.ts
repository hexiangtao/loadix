/**
 * Site adapters — one small module per platform, registered in one place.
 *
 * The product promise is "paste a playback page → get the real format list".
 * That promise is per-site work: every site buries its play data somewhere
 * different, and the shapes drift. So each site gets an adapter with a
 * `match` (cheap, URL-only) and a `resolve` (the site's actual chain), and
 * `resolvePageUrl` walks the registry. Adding a platform is one object
 * literal — not another branch in an if-chain.
 *
 * Two rules every adapter follows:
 *   1. Return `null` when the site turns out not to apply or the chain
 *      fails, so the caller can fall through to the next adapter and
 *      finally to the generic HTML scan. An adapter must never throw the
 *      whole resolve away.
 *   2. Never guess a download URL. If the site did not hand one out, say so
 *      (an empty format list) rather than shipping a 403 to the user.
 *
 * Adapters are pure with respect to the network: they receive a `fetchText`,
 * so every one of them is testable against fixture HTML.
 */

import {
  dashEntriesToFormats,
  decodeEntities,
  embeddedJson,
  normalizeImageUrl,
  pageTitle,
  posterFromMeta,
} from './pageHtml';
import type { MediaFormatOption, ResolvedPageAsset, VideoPart } from './mediaResolver';
import type { FetchText, MediaProvider, MediaProviderContext } from './mediaProvider';
import { failureFromError, hostOf, type ResolveFailure } from './resolveFailure';

// The local `hostName` below is the site-matching helper (returns '' so
// `isHost` can compare safely); `hostOf` is the failure-reporting one that
// yields `undefined` when a URL is unparseable.

/** What an adapter is given. Kept deliberately thin: the page URL and a
 *  fetcher. Everything else an adapter needs it reads out of the HTML.
 *
 *  `report` is how an adapter explains itself when it gives up. Returning
 *  `null` alone used to mean the reason died with the adapter, and the UI could
 *  only say "could not resolve this page" — so a login wall, a region lock and
 *  our own broken network all looked identical. Reporting costs one call and
 *  turns each of those into different advice. */
/** Backward-compatible names for callers that used the original adapter API. */
export type ResolveContext = MediaProviderContext;
export type SiteAdapter = MediaProvider;
export type { FetchText };

function hostName(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return '';
  }
}

/** Host test that matches the domain and its subdomains only. A plain
 *  `includes()` here would let `acfun.cn.evil.com` through. */
function isHost(pageUrl: string, domain: string): boolean {
  const host = hostName(pageUrl).toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/* ------------------------------------------------------------------ */
/* AcFun                                                               */
/* ------------------------------------------------------------------ */

/** `acfun.cn/v/ac12345678`, plus the mobile `m.acfun.cn/v/?ac=12345678`. */
const ACFUN_PATH = /\/v\/(?:ac(\d+)|[^/]*\?.*\bac=(\d+))/i;

function acfunId(pageUrl: string): string | null {
  const match = pageUrl.match(ACFUN_PATH);
  return match?.[1] ?? match?.[2] ?? null;
}

/** One entry of `ksPlayJson.adaptationSet[0].representation`. */
interface AcfunRepresentation {
  url?: string;
  backupUrl?: string[];
  width?: number;
  height?: number;
  frameRate?: number;
  codecs?: string;
  qualityType?: string;
  qualityLabel?: string;
  avgBitrate?: number;
}

interface AcfunPlayInfo {
  adaptationSet?: { representation?: AcfunRepresentation[] }[];
}

/** AcFun's title lives in `<h1 class="title"><span>…</span></h1>`; the
 *  document `<title>` carries the site's own 「- AcFun弹幕视频网 …」 suffix. */
function acfunTitle(html: string): string | undefined {
  const heading = html.match(/<h1[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]{0,300}?)<\/h1>/i)?.[1];
  const text = heading?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text) return decodeEntities(text);
  return pageTitle(html, /\s*[-_|]\s*AcFun[\s\S]*$/i);
}

/** The poster. AcFun declares it as `og:image` on some layouts and as a
 *  `coverUrl` field in its page data on others. */
function acfunCover(html: string): string | undefined {
  return (
    posterFromMeta(html) ??
    normalizeImageUrl(html.match(/"coverUrl"\s*:\s*"(https?:[^"]+)"/)?.[1]?.replace(/\\\//g, '/')) ??
    normalizeImageUrl(html.match(/"cover"\s*:\s*"(https?:[^"]+)"/)?.[1]?.replace(/\\\//g, '/'))
  );
}

/**
 * AcFun chain (verified live against a real video page):
 *
 *   1. GET the video page. It server-renders `currentVideoInfo.ksPlayJson`,
 *      a JSON *string* holding the full play info. Because the value is a
 *      string inside a JSON blob inside a `<script>`, it needs two decodes
 *      — which is what `embeddedJson` does.
 *   2. Each `adaptationSet[0].representation[]` is one quality: a complete
 *      HLS playlist (`application/vnd.apple.mpegurl`) that already carries
 *      its own audio, plus a mirror on a second CDN. Segments are relative
 *      URLs — the HLS engine resolves them against the playlist URL.
 *
 * Verified properties that matter for the rest of the pipeline:
 *   - the playlists and their segments serve fine with NO Referer, so the
 *     engine's `no-referrer` policy is safe here (unlike Bilibili's DASH
 *     video track, which 403s without a bilibili Referer)
 *   - the CDN copies are CORS-open, so the web build downloads them
 *     directly and never pays for the proxy
 */
const acfun: SiteAdapter = {
  id: 'acfun',
  label: 'AcFun',
  example: 'https://www.acfun.cn/v/ac48825923',
  match: (pageUrl) => isHost(pageUrl, 'acfun.cn') && acfunId(pageUrl) != null,
  resolve: async ({ pageUrl, fetchText }) => {
    const html = await fetchText(pageUrl);
    const info =
      embeddedJson<AcfunPlayInfo>(html, 'ksPlayJson') ??
      (embeddedJson<{ ksPlayJson?: string }>(html, 'currentVideoInfo')?.ksPlayJson
        ? (JSON.parse(embeddedJson<{ ksPlayJson?: string }>(html, 'currentVideoInfo')!.ksPlayJson!) as AcfunPlayInfo)
        : null);
    const representations = info?.adaptationSet?.[0]?.representation ?? [];
    if (!representations.length) return null;

    // One row per resolution, best codec first: H.264 plays everywhere,
    // so when a height is offered in several codecs prefer it, then the
    // higher frame rate.
    const byHeight = new Map<number, AcfunRepresentation>();
    for (const rep of representations) {
      if (!rep.url || !rep.height) continue;
      const current = byHeight.get(rep.height);
      if (!current) {
        byHeight.set(rep.height, rep);
        continue;
      }
      const rank = (r: AcfunRepresentation) =>
        (r.codecs?.startsWith('avc') ? 1 : 0) * 1000 + (r.frameRate ?? 0);
      if (rank(rep) > rank(current)) byHeight.set(rep.height, rep);
    }

    const formats: MediaFormatOption[] = [...byHeight.values()]
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.frameRate ?? 0) - (a.frameRate ?? 0))
      .map((rep) => ({
        key: `hls-${rep.qualityType ?? rep.height}`,
        container: 'hls' as const,
        // Keep AcFun's own label — it carries the frame rate (1080P60),
        // which is real information the user is choosing between.
        quality: rep.qualityLabel ?? `${rep.height}p`,
        hasAudio: true,
        // HLS has no declared size: the playlist would have to be fetched
        // and summed, and the UI shows unknown honestly.
        size: 0,
        url: rep.url!,
        backupUrls: (rep.backupUrl ?? []).filter((url) => /^https?:/i.test(url)),
      }));
    if (!formats.length) return null;

    return {
      title: acfunTitle(html) ?? `ac${acfunId(pageUrl) ?? ''}`,
      cover: acfunCover(html),
      pageUrl,
      formats,
      dashOnly: false,
      notice: '',
    };
  },
};

/* ------------------------------------------------------------------ */
/* Bilibili 番剧 / 课程 (PGC)                                          */
/* ------------------------------------------------------------------ */

/** `/bangumi/play/ep826497`, `/bangumi/play/ss47836`, `/cheese/play/ep…`. */
const BILI_PGC_PATH = /bilibili\.com\/(?:bangumi|cheese)\/play\/(ep|ss)(\d+)/i;

interface PgcEpisode {
  id?: number;
  aid?: number;
  bvid?: string;
  cid?: number | string;
  title?: string;
  long_title?: string;
  duration?: number;
}

interface PgcSeason {
  code?: number;
  message?: string;
  result?: {
    title?: string;
    cover?: string;
    episodes?: PgcEpisode[];
  };
}

/**
 * Bilibili PGC chain (verified live, anonymously):
 *
 *   1. `pgc/view/web/season?ep_id=…|season_id=…` → the series title plus
 *      EVERY episode. This is a real part list, which is why a 番剧 maps
 *      onto the existing multi-part UI and batch downloader with no new
 *      machinery: an episode is addressable (`/bangumi/play/ep{id}`) the
 *      same way a 分P is (`?p=n`).
 *   2. `pgc/player/web/playurl?ep_id=…&fnval=4048` → DASH tracks. Unlike
 *      the `x/player` endpoint this one accepts an anonymous caller, and
 *      the tracks carry a real byte `size`, so sizes here are measured,
 *      not estimated.
 *
 * What it deliberately does NOT promise: the html5 muxed-MP4 endpoint that
 * gives Bilibili videos their complete "720p with sound" file answers
 * `-404` for PGC content, so a 番剧 has no pre-muxed option and an anonymous
 * caller is granted 480p rather than 1080p. That is not a "video-only"
 * result though — every row here is a `dash-mux` pair, and the mux step
 * merges it into one playable file, so the UI reports a complete download.
 */
const bilibiliPgc: SiteAdapter = {
  id: 'bilibili-pgc',
  // Brands stay in Latin script so the list reads the same in every locale
  // (these labels live in the registry, not in i18n, on purpose: a platform
  // is a proper noun, and duplicating it five times invites drift).
  label: 'Bilibili 番剧 / 课程',
  example: 'https://www.bilibili.com/bangumi/play/ep826497',
  match: (pageUrl) => isHost(pageUrl, 'bilibili.com') && BILI_PGC_PATH.test(pageUrl),
  resolve: async ({ pageUrl, fetchText, report }) => {
    const match = pageUrl.match(BILI_PGC_PATH);
    if (!match) return null;
    const kind = match[1]!.toLowerCase() === 'ep' ? 'ep_id' : 'season_id';
    const id = match[2]!;
    const seasonApi = `https://api.bilibili.com/pgc/view/web/season?${kind}=${id}`;

    let season: PgcSeason;
    try {
      season = JSON.parse(await fetchText(seasonApi)) as PgcSeason;
    } catch (err) {
      report(failureFromError(err, seasonApi));
      return null;
    }
    if (season.code != null && season.code !== 0) {
      // `-404` is a missing episode/season and `-10403` is a region lock —
      // both are "this content is not for you", which is a different
      // instruction to the user than the WAF's `-412` or a plain refusal.
      const gone = season.code === -404 || season.code === -10403;
      report({
        reason: gone ? 'unavailable' : 'blocked',
        host: hostOf(seasonApi),
        detail: season.message?.trim() || `code ${season.code}`,
      });
      return null;
    }
    const episodes = (season.result?.episodes ?? []).filter((episode) => episode.id != null);
    if (!episodes.length) return null;

    // `ep` pins one episode; `ss` means "the season", which the page itself
    // opens on the first episode.
    const target = kind === 'ep_id' ? episodes.find((episode) => String(episode.id) === id) ?? episodes[0]! : episodes[0]!;

    let dash: { video?: unknown[]; audio?: unknown[]; duration?: number } | undefined;
    let durl: { url?: string; backup_url?: string[]; size?: number }[] | undefined;
    try {
      const play = JSON.parse(
        await fetchText(
          `https://api.bilibili.com/pgc/player/web/playurl?ep_id=${target.id}&fnval=4048&qn=127&fnver=0&fourk=1`,
        ),
      ) as { result?: { dash?: typeof dash; durl?: typeof durl } };
      dash = play.result?.dash;
      durl = play.result?.durl;
    } catch {
      /* fall through to whatever the season call gave us */
    }

    const formats: MediaFormatOption[] = [];
    // Some PGC content (older 课程) still ships whole muxed files.
    for (const [index, part] of (durl ?? []).entries()) {
      if (!part.url) continue;
      formats.push({
        key: `mp4-pgc-${index}`,
        container: 'mp4',
        quality: 'MP4',
        hasAudio: true,
        size: part.size ?? 0,
        url: part.url,
        backupUrls: part.backup_url ?? [],
      });
    }
    formats.push(...dashEntriesToFormats(dash as never, { audio: 'always' }));

    const series = season.result?.title?.trim() || `ep${target.id}`;
    const episodeName = target.long_title?.trim() || target.title?.trim() || '';
    // With a real episode list the series name is the right headline (the
    // list says which episode the formats belong to). A single-episode page
    // has no list to disambiguate, so the episode name joins the title.
    const manyEpisodes = episodes.length > 1;
    const title = manyEpisodes || !episodeName ? series : `${series} - ${episodeName}`;

    const parts: VideoPart[] | undefined = manyEpisodes
      ? episodes.map((episode, at) => ({
          index: at + 1,
          cid: String(episode.cid ?? ''),
          title: episode.long_title?.trim() || episode.title?.trim() || `第${at + 1}话`,
          // PGC reports episode length in MILLISECONDS (2937220 for a 49-min
          // episode) where a /video/ page's 分P are in seconds. Passed
          // through unconverted it renders as "816:07:40".
          durationSeconds: Math.round((episode.duration ?? 0) / 1000),
          // PGC episodes are not `?p=n` — each one is its own URL, so the
          // adapter supplies it and the batch downloader follows it.
          url: `${new URL(pageUrl).origin}${new URL(pageUrl).pathname.split('/play/')[0]}/play/ep${episode.id}`,
        }))
      : undefined;

    const position = manyEpisodes ? episodes.findIndex((episode) => episode.id === target.id) + 1 : undefined;

    const complete = formats.filter((format) => format.container === 'mp4' || format.container === 'dash-mux');
    return {
      title,
      cover: normalizeImageUrl(season.result?.cover),
      pageUrl,
      formats,
      parts,
      // These are episodes, not 分P — the UI says so instead of calling a TV
      // season's second episode "P2".
      partsLabel: manyEpisodes ? 'episodes' : undefined,
      partIndex: position && position > 0 ? position : undefined,
      dashOnly: complete.length === 0 && formats.length > 0,
      notice: formats.length === 0 ? 'empty' : complete.length === 0 ? 'dash-only' : '',
    };
  },
};

/* ------------------------------------------------------------------ */
/* YouTube                                                             */
/* ------------------------------------------------------------------ */

/**
 * YouTube's public innertube key — the one every web client ships in its own
 * bundle, not a secret. It only routes the request to a player endpoint.
 */
const YT_INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

/**
 * The client identity to ask as, and the ONE choice that decides whether this
 * adapter can exist.
 *
 * The web clients (WEB / MWEB / WEB_EMBEDDED) answer `UNPLAYABLE` for an
 * anonymous request, and — when they do answer — hand out format metadata
 * with no `url` at all: media is delivered over SABR (a POST streaming
 * session) and every adaptive entry is metadata-only. `ANDROID_VR` demands
 * login, `IOS` and `TVHTML5` fail. The ANDROID client is the one that still
 * answers `status=OK` with a `url` on every format (verified across several
 * videos, 39/29/19 formats, zero ciphers), and it does so for ANY request
 * User-Agent — which is what makes it usable from a page that cannot set its
 * own UA. Bumping this version string is the maintenance cost of this adapter.
 */
const YT_CLIENT = {
  clientName: 'ANDROID',
  clientVersion: '20.10.38',
  androidSdkVersion: 34,
} as const;

/** `/watch?v=…`, `/shorts/…`, `/embed/…`, `/live/…`, `youtu.be/…`. */
const YT_ID_PATTERNS = [
  /youtube\.com\/watch\?(?:[^#]*&)?v=([\w-]{11})/i,
  /youtube\.com\/(?:shorts|embed|live|v)\/([\w-]{11})/i,
  /youtu\.be\/([\w-]{11})/i,
];

function youtubeId(pageUrl: string): string | null {
  for (const pattern of YT_ID_PATTERNS) {
    const match = pageUrl.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** One entry of `streamingData.formats` / `adaptiveFormats`. */
interface YoutubeFormat {
  itag?: number;
  url?: string;
  /** Read for the codecs, not the container: the muxed entries list `mp4a` in
   *  their codec string, which is how `hasAudio` is decided from data rather
   *  than assumed. */
  mimeType?: string;
  qualityLabel?: string;
  /** Declared byte size. Present on adaptive entries; the muxed one omits it. */
  contentLength?: string;
}

interface YoutubePlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  streamingData?: { formats?: YoutubeFormat[]; adaptiveFormats?: YoutubeFormat[] };
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
    thumbnail?: { thumbnails?: { url?: string; width?: number }[] };
  };
}

/**
 * The muxed entry declares NO size anywhere: `contentLength` is absent from
 * the payload AND the URL carries no `clen` (verified — the adaptive entries
 * have both; the progressive one has neither). So the honest answer for that
 * row is "unknown", and the download's own `Content-Length` fills it in while
 * it runs, rather than an estimate that would be wrong by megabytes.
 */
function declaredBytes(format: YoutubeFormat): number {
  const declared = Number(format.contentLength);
  return Number.isFinite(declared) && declared > 0 ? declared : 0;
}

/**
 * YouTube's own size ladder, and the honest limit of what this adapter can do.
 *
 * Measured against the live CDN (reproducible, header- and UA-independent):
 * every ADAPTIVE track is served only for roughly its first minute and then
 * answers `403` with an empty body — 12 MiB of a 143.6 MiB 720p60 track, 1 MiB
 * of its 9.8 MiB audio. The wall is a byte POSITION, not a budget: offsets past
 * it are refused on a brand-new URL from a brand-new player call, and after a
 * cooldown the same URL serves the same first 12 MiB again. So there is no
 * rotation trick that reaches the rest of the track, and offering those rows
 * would hand the user a one-minute file that looks complete.
 *
 * The pre-muxed `formats` entries are not capped: one URL delivered the whole
 * 27.2 MiB 360p file, in 4 MiB windows, resumable at any offset. That is the
 * complete, playable, resumable download this adapter offers — and why the UI
 * is told so with the `sd-only` notice instead of silently listing less.
 */
const youtube: SiteAdapter = {
  id: 'youtube',
  label: 'YouTube',
  example: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  match: (pageUrl) => isHost(pageUrl, 'youtube.com') || isHost(pageUrl, 'youtu.be') || isHost(pageUrl, 'youtube-nocookie.com'),
  resolve: async ({ pageUrl, fetchText, report }) => {
    const videoId = youtubeId(pageUrl);
    if (!videoId) return null;

    let player: YoutubePlayerResponse;
    try {
      player = JSON.parse(
        await fetchText(`https://www.youtube.com/youtubei/v1/player?key=${YT_INNERTUBE_KEY}&prettyPrint=false`, {
          method: 'POST',
          body: JSON.stringify({
            context: { client: { ...YT_CLIENT, hl: 'en', gl: 'US' } },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
          headers: {
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': '3',
            'X-YouTube-Client-Version': YT_CLIENT.clientVersion,
          },
        }),
      ) as YoutubePlayerResponse;
    } catch (err) {
      // Endpoint unreachable (a proxy-less server, a network wall) — report it,
      // then let the generic scan try the page itself.
      report(failureFromError(err, 'https://www.youtube.com'));
      return null;
    }

    const details = player.videoDetails;
    const cover = normalizeImageUrl(
      [...(details?.thumbnail?.thumbnails ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
    );

    if (player.playabilityStatus?.status !== 'OK') {
      // YouTube's own words decide which advice applies: "Sign in to confirm
      // you're not a bot" is a login wall the user can clear, while a private,
      // deleted or region-locked video is simply not available. Both used to
      // arrive as "found nothing".
      const status = player.playabilityStatus?.status ?? 'ERROR';
      const reason = player.playabilityStatus?.reason ?? '';
      // Returned rather than reported-and-abandoned: the refusal replaces the
      // page with a consent interstitial whose own title is literally
      // `- YouTube`, so the generic scan would hand the card a junk title and no
      // artwork. We already have the real ones here.
      return {
        title: details?.title?.trim() || videoId,
        cover,
        pageUrl,
        formats: [],
        dashOnly: false,
        notice: 'empty',
        failure: {
          reason: status === 'LOGIN_REQUIRED' || /sign in|not a bot/i.test(reason) ? 'login' : 'unavailable',
          host: 'www.youtube.com',
          detail: reason || status,
        },
      };
    }

    const formats: MediaFormatOption[] = (player.streamingData?.formats ?? [])
      .filter((format) => format.url)
      .map((format, index) => ({
        key: `mp4-yt-${format.itag ?? index}`,
        container: 'mp4' as const,
        // YouTube's own label (360p / 240p …) — the CDN ceiling moves with the
        // video's age and the client version, so never hard-code a number.
        quality: format.qualityLabel ?? 'MP4',
        // Derived, not assumed: the muxed entries declare `mp4a` in their codec
        // string (itag 18: `avc1.42001E, mp4a.40.2`). If a video ever offers a
        // progressive entry with no audio, the row says so.
        hasAudio: /mp4a/i.test(format.mimeType ?? ''),
        size: declaredBytes(format),
        url: format.url!,
        backupUrls: [],
      }))
      .sort(
        (a, b) => (Number.parseInt(b.quality, 10) || 0) - (Number.parseInt(a.quality, 10) || 0),
      );

    if (!formats.length) {
      // Playback succeeded but handed out nothing muxed — rare (some VR and
      // codec-gated uploads). Nothing the user can fix, but say so precisely
      // rather than as a generic "could not resolve".
      report({ reason: 'no-format', host: 'www.youtube.com', detail: player.playabilityStatus?.status });
    }

    return {
      title: details?.title?.trim() || videoId,
      cover,
      pageUrl,
      formats,
      dashOnly: false,
      notice: formats.length ? 'sd-only' : 'empty',
    };
  },
};

/** True for a YouTube watch-page URL.
 *
 *  Exported because the extension has to install a network rule for these
 *  resolves specifically: youtubei's player endpoint answers `403` to any
 *  request carrying an extension origin (verified: `Origin:
 *  chrome-extension://…` → 403, `Origin: https://www.youtube.com` → 200,
 *  absent → 200), and it is POST-only (GET → 405), so a browser stamps the
 *  one header that breaks it and no page can take it back. */
export const isYouTubePageUrl = (pageUrl: string): boolean => youtube.match(pageUrl);

/** Everything this module contributes to the resolver's dispatch order.
 *  Site adapters are tried most-specific-first, so this list is ordered. */
export const BUILT_IN_ADAPTERS: readonly SiteAdapter[] = [bilibiliPgc, acfun, youtube];

/** Platform list for the UI's "what can I paste" hint. Derived from the
 *  registry on purpose: a new adapter shows up in the UI by existing, so
 *  the copy can never drift from what actually resolves. */
export const BUILT_IN_PLATFORMS: readonly { id: string; label: string; example: string }[] =
  BUILT_IN_ADAPTERS.map(({ id, label, example }) => ({ id, label, example }));


