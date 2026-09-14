/**
 * Server-side media resolver core — framework-agnostic, like share-core.
 *
 * WHY a server: Bilibili's web APIs reject cross-origin browser calls
 * outright (403 on any foreign Origin header, CORS headers never sent),
 * so the web build cannot resolve a watch page client-side. This core
 * performs the same chain the extension does (watch page → cid → html5
 * playurl API), with honest browser headers (UA + Referer, NO Origin —
 * that header is what triggers their 403), and hands the client a
 * ResolvedPageAsset — the same shape the extension's resolver returns.
 *
 * The CDN bytes themselves are open (they mirror any Origin in
 * Access-Control-Allow-Origin and ignore Referer), so after resolution
 * the client downloads DIRECTLY from the CDN — no video proxying through
 * this endpoint, ever.
 *
 * Runs in three places via adapters:
 *   - functions/api/resolve.js        (Cloudflare Pages, production web)
 *   - vite dev server middleware      (npm run dev:web)
 *   - .freebuff/serve-share.mjs       (static preview)
 *
 * Abuse guard: rate-limited per IP and bounded (one page + a handful of
 * API GETs per request, response strings capped, no HTML is echoed back).
 */

import { resolvePageUrl } from '../../src/entrypoints/dashboard/media/mediaResolver.js';
import { failureFromError } from '../../src/entrypoints/dashboard/media/resolveFailure.js';

/**
 * An error that says WHY it failed, in the shape the resolver's failure
 * taxonomy reads (`FetcherErrorFields` in resolveFailure.ts).
 *
 * A bare `new Error('HTTP 403')` reaches the user as one generic sentence that
 * cannot distinguish "the site refused you" from "we could not reach the site"
 * — and that sentence has already blamed a site for our own broken network
 * once. The fields are plain data so they survive `postMessage` and JSON, and
 * they are attached HERE because this is the only frame that knows the truth.
 */
function fetchFailure(message, fields) {
  const error = new Error(message);
  Object.assign(error, fields);
  return error;
}

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const rateBuckets = new Map();

function rateLimited(key) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count++;
  return bucket.count > MAX_PER_WINDOW;
}

// NOTE: the Chrome version is not arbitrary. Bilibili's WAF blocks
// `Chrome/126.0.0.0` specifically — `x/web-interface/view` answers
// `412 {"code":-412,"message":"request was banned"}` for that exact string
// while 120/124/127/128/131/133/136 all pass (verified against the live API),
// no doubt because a scraper library defaults to it. The resolve degrades
// quietly when that API refuses (no part list, part name instead of the
// video's title), so a blocked UA is a silent content-loss bug, not a
// visible failure. Prefer a version verified to pass before bumping.
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';

/** Sites whose pages Set-Cookie on first contact and expect it back
 *  (Douyin's share page issues `ttwid` and only embeds the video item
 *  when the retry presents it). Keyed per page request — never cached
 *  across users. */
function cookieJarFor(pageUrl) {
  const jar = new Map();
  return {
    store(res) {
      const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      for (const line of cookies) {
        const pair = line.split(';', 1)[0];
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    host: new URL(pageUrl).hostname,
  };
}

/** Header posture that curl-verified works per site: real UA (mobile for
 *  Douyin — its share data is mobile-gated), site-matching Referer, and
 *  crucially NO Origin header (a foreign Origin is Bilibili's 403
 *  trigger). Response Set-Cookies are stored and replayed within this
 *  single page resolution. */
/** Referer for a request, keyed off the TARGET host — the same-origin
 *  Referer a browser would send for a site's own API. Without this, a
 *  short-link resolve sends `https://b23.tv/` to Bilibili's playurl API,
 *  which answers an HTML error page instead of JSON (verified), silently
 *  costing the resolve every muxed MP4. */
const refererFor = (url, fallbackHost) => {
  try {
    if (/(?:^|\.)bilibili\.com$/i.test(new URL(url).hostname)) return 'https://www.bilibili.com/';
  } catch {
    /* unparseable — fall back to the page's own origin */
  }
  return `https://${fallbackHost}/`;
};

const makeBrowserFetchText = (pageUrl) => {
  const jar = cookieJarFor(pageUrl);
  const fetchOnce = async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const cookie = jar.header();
      const headers = {
        'User-Agent': options.mobile === true ? MOBILE_UA : DESKTOP_UA,
        Referer: refererFor(url, jar.host),
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        // A site's OWN client identity goes last so it wins: YouTube's player
        // endpoint is POST-only and discriminated by these headers, and the
        // generic defaults above (plus a Referer) do not describe that client.
        ...(options.headers ?? {}),
      };
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        method: options.method ?? 'GET',
        headers,
        ...(options.body != null ? { body: options.body } : {}),
      });
      jar.store(res);
      if (!res.ok) throw fetchFailure(`HTTP ${res.status}`, { kind: 'http', url, status: res.status });
      const text = await res.text();
      // Guard against someone pointing us at a huge non-page resource.
      return {
        text: text.length > 3_000_000 ? text.slice(0, 3_000_000) : text,
        finalUrl: res.url || url,
      };
    } catch (err) {
      // A network-level rejection (proxy reset, DNS, TLS, timeout) arrives as a
      // bare TypeError whose real cause is on `cause` — undici's design. Keep
      // the message for the detail line and lift the code out where the
      // classifier can see it.
      if (err && typeof err === 'object' && err.kind) throw err;
      const base = err instanceof Error ? err : new Error(String(err));
      const code = base.cause?.code ?? (base.name === 'AbortError' ? 'ETIMEDOUT' : undefined);
      throw fetchFailure(base.message, { kind: 'network', url, ...(code ? { code } : {}) });
    } finally {
      clearTimeout(timer);
    }
  };
  const fetchText = (url, options) => fetchOnce(url, options).then((result) => result.text);
  // The post-redirect URL is the only place a b23.tv share code's canonical
  // watch page exists — hand it to the resolver's short-link path.
  fetchText.withUrl = (url, options) => fetchOnce(url, options);
  return fetchText;
};

const browserFetchText = (url, options) => makeBrowserFetchText(url)(url, options);

/** Rate-limit key: the caller's IP as seen by the host platform. */
function clientIp(req) {
  const forwarded = req.headers?.get('cf-connecting-ip') ?? req.headers?.get('x-forwarded-for');
  return (forwarded ?? 'local').split(',')[0].trim();
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

/** GET `?proxyUrl=…` — stream a media CDN response through this origin.
 *  Needed only where the CDN sends no CORS headers (verified: Douyin's
 *  douyinvod.com); Bilibili's CDN is open and never routes through here.
 *  Range requests pass through so the dashboard's resume logic keeps
 *  working; the response is streamed, never buffered whole. A 30s IDLE
 *  timeout (reset per chunk) guards against hung upstreams without
 *  capping long healthy downloads. */
async function handleProxy(req, target) {
  if (target.length > 2048) return jsonResponse({ error: 'bad-url' }, 400);
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return jsonResponse({ error: 'bad-url' }, 400);
  }
  if (!/^https?:$/.test(parsed.protocol) || isInternalHost(parsed.hostname) || !MEDIA_CDN_HOST.test(parsed.hostname)) {
    return jsonResponse({ error: 'bad-url' }, 400);
  }
  // A page cannot set its own Referer, and Bilibili's CDN refuses any request
  // whose Referer is not a bilibili origin (verified live: 403 with a foreign
  // or absent Referer, 206 with the site's own) — which is exactly why those
  // downloads need this origin. Douyin's CDN instead keys off the mobile UA.
  const headers = BILI_CDN_HOST.test(parsed.hostname)
    ? { 'User-Agent': DESKTOP_UA, Referer: 'https://www.bilibili.com/', Accept: '*/*' }
    : YOUTUBE_CDN_HOST.test(parsed.hostname)
      ? { 'User-Agent': DESKTOP_UA, Referer: 'https://www.youtube.com/', Accept: '*/*' }
      : { 'User-Agent': MOBILE_UA, Referer: 'https://www.douyin.com/', Accept: '*/*' };
  const range = req.headers?.get('range');
  if (range) headers.Range = range;
  const controller = new AbortController();
  let timer;
  const bumpIdle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), 30_000);
  };
  let upstream;
  try {
    bumpIdle();
    upstream = await fetch(target, { redirect: 'follow', signal: controller.signal, headers });
    bumpIdle();
  } catch {
    clearTimeout(timer);
    return jsonResponse({ error: 'proxy-fetch-failed' }, 502);
  }
  if (!upstream.ok && upstream.status !== 206) {
    clearTimeout(timer);
    return jsonResponse({ error: `upstream-${upstream.status}` }, 502);
  }
  const outHeaders = { ...CORS_HEADERS, 'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream' };
  for (const name of ['content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(name);
    if (value) outHeaders[name] = value;
  }
  const reader = upstream.body.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        bumpIdle();
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(timer);
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        clearTimeout(timer);
        controller.error(err);
      }
    },
    cancel() {
      clearTimeout(timer);
      void reader.cancel();
    },
  });
  return new Response(stream, { status: upstream.status, headers: outHeaders });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function isInternalHost(hostname) {
  return /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[::)/i.test(hostname);
}

/** Hosts the proxy will fetch from — the video CDNs this app downloads
 *  from, and nothing else. This is NOT a general open proxy: anything else
 *  is refused at the door. */
const MEDIA_CDN_HOST =
  /(?:^|\.)(douyinvod\.com|zjcdn\.com|snssdk\.com|iesdouyin\.com|douyin\.com|bilivideo\.com|bilivideo\.cn|akamaized\.net|googlevideo\.com|ytimg\.com)$/i;

/** YouTube's media CDNs. They ignore Referer and User-Agent (verified: 200/206
 *  for a Chrome UA with no Referer, an Android UA, and a YouTube Referer
 *  alike) — these bytes are proxied only because the browser cannot read them
 *  from a page origin, not because the CDN demands anything. */
const YOUTUBE_CDN_HOST = /(?:^|\.)(googlevideo\.com|ytimg\.com)$/i;

/** The subset that is hotlink-gated: Bilibili serves the DASH video track
 *  only when the Referer is a bilibili origin. The muxed html5 MP4 and the
 *  audio track are open (verified), so they never route through here. */
const BILI_CDN_HOST = /(?:^|\.)(bilivideo\.com|bilivideo\.cn|akamaized\.net)$/i;

/**
 * Handle `GET|POST /api/resolve?pageUrl=…` (POST body JSON {pageUrl} also
 * accepted; pass it via `rawBody`). Returns `{ resolved }` or `{ error }`
 * — the same contract the dashboard already speaks for `media:scrape`.
 */
export async function handleResolve(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  let href = req.url ?? '/';
  // Adapters may hand us a path-only URL; anchor it so new URL() works.
  if (!/^https?:\/\//i.test(href)) href = `http://local${href.startsWith('/') ? '' : '/'}${href}`;
  const url = new URL(href);
  let pageUrl = url.searchParams.get('pageUrl') ?? '';
  if (!pageUrl && req.method === 'POST' && typeof req.rawBody === 'string' && req.rawBody) {
    try {
      pageUrl = String(JSON.parse(req.rawBody).pageUrl ?? '');
    } catch {
      /* fallthrough — pageUrl stays empty */
    }
  }
  if (rateLimited(clientIp(req))) return jsonResponse({ error: 'rate-limited' }, 429);

  // Streaming proxy lane (?proxyUrl=…) — validated on its own terms BEFORE
  // the pageUrl checks (a proxy call carries no pageUrl).
  const proxyUrl = url.searchParams.get('proxyUrl') ?? '';
  if (proxyUrl) return handleProxy(req, proxyUrl);

  if (!/^https?:\/\//i.test(pageUrl)) return jsonResponse({ error: 'bad-url' }, 400);
  // SSRF guard: only public http(s) pages.
  let parsed;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return jsonResponse({ error: 'bad-url' }, 400);
  }
  if (!/^https?:$/.test(parsed.protocol) || isInternalHost(parsed.hostname)) {
    return jsonResponse({ error: 'bad-url' }, 400);
  }
  // (Rate limit already charged above — the proxy lane shares this request.)

  try {
    const fetcher = makeBrowserFetchText(pageUrl);
    const resolved = await resolvePageUrl(pageUrl, fetcher, fetcher.withUrl);
    return jsonResponse({ resolved });
  } catch (err) {
    // Only unexpected throws reach here — the resolver returns expected
    // failures inside `resolved.failure`. Ship the classification anyway, so
    // the panel never has to reconstruct a reason from a string.
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'resolve-failed', failure: failureFromError(err, pageUrl) },
      502,
    );
  }
}
