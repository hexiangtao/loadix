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
import type { FetchText, MediaFormatOption, ResolvedPageAsset, VideoPart } from './mediaResolver';

/** What an adapter is given. Kept deliberately thin: the page URL and a
 *  fetcher. Everything else an adapter needs it reads out of the HTML. */
export interface ResolveContext {
  pageUrl: string;
  fetchText: FetchText;
}

export interface SiteAdapter {
  /** Stable id — also what the UI keys the supported-platform list by. */
  id: string;
  /** Human name for the UI. */
  label: string;
  /** Example URL shape, shown as a hint so users know what to paste. */
  example: string;
  /** Cheap URL test. Must not fetch. */
  match: (pageUrl: string) => boolean;
  /** The site's resolution chain. `null` ⇒ not this adapter's business. */
  resolve: (context: ResolveContext) => Promise<ResolvedPageAsset | null>;
}

function hostOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return '';
  }
}

/** Host test that matches the domain and its subdomains only. A plain
 *  `includes()` here would let `acfun.cn.evil.com` through. */
function isHost(pageUrl: string, domain: string): boolean {
  const host = hostOf(pageUrl).toLowerCase();
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
  resolve: async ({ pageUrl, fetchText }) => {
    const match = pageUrl.match(BILI_PGC_PATH);
    if (!match) return null;
    const kind = match[1]!.toLowerCase() === 'ep' ? 'ep_id' : 'season_id';
    const id = match[2]!;

    let season: PgcSeason;
    try {
      season = JSON.parse(
        await fetchText(`https://api.bilibili.com/pgc/view/web/season?${kind}=${id}`),
      ) as PgcSeason;
    } catch {
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

/** Everything this module contributes to the resolver's dispatch order.
 *  Site adapters are tried most-specific-first, so this list is ordered. */
export const BUILT_IN_ADAPTERS: readonly SiteAdapter[] = [bilibiliPgc, acfun];

/** Platform list for the UI's "what can I paste" hint. Derived from the
 *  registry on purpose: a new adapter shows up in the UI by existing, so
 *  the copy can never drift from what actually resolves. */
export const BUILT_IN_PLATFORMS: readonly { id: string; label: string; example: string }[] =
  BUILT_IN_ADAPTERS.map(({ id, label, example }) => ({ id, label, example }));


