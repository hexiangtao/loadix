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

/** Same header posture that curl-verified works: real UA, bilibili
 *  Referer, and crucially NO Origin (a foreign Origin is the 403 trigger). */
const browserFetchText = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Referer: 'https://www.bilibili.com/',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // Guard against someone pointing us at a huge non-page resource.
    return text.length > 3_000_000 ? text.slice(0, 3_000_000) : text;
  } finally {
    clearTimeout(timer);
  }
};

/** Rate-limit key: the caller's IP as seen by the host platform. */
function clientIp(req) {
  const forwarded = req.headers?.get('cf-connecting-ip') ?? req.headers?.get('x-forwarded-for');
  return (forwarded ?? 'local').split(',')[0].trim();
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function isInternalHost(hostname) {
  return /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[::)/i.test(hostname);
}

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
  if (rateLimited(clientIp(req))) return jsonResponse({ error: 'rate-limited' }, 429);

  try {
    const resolved = await resolvePageUrl(pageUrl, browserFetchText);
    return jsonResponse({ resolved });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'resolve-failed' }, 502);
  }
}
