/**
 * Standalone Media Worker core.
 *
 * The queue is intentionally executor-agnostic. A future executor can call
 * yt-dlp, FFmpeg, or a browser resolver without changing the HTTP protocol.
 */

const DEFAULT_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_TASKS = 100;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

function taskView(task) {
  return {
    taskId: task.id,
    state: task.state,
    ...(task.result ? { result: task.result } : {}),
    ...(task.failure ? { failure: task.failure } : {}),
  };
}

function failure(reason, detail) {
  return { reason, detail: String(detail).slice(0, 240) };
}

/**
 * Hosts the streaming proxy will fetch from — the video CDNs this app
 * downloads from, and nothing else. NOT a general open proxy.
 */
const PROXY_HOST =
  /(?:^|\.)(douyinvod\.com|zjcdn\.com|snssdk\.com|iesdouyin\.com|douyin\.com|bilivideo\.com|bilivideo\.cn|akamaized\.net|googlevideo\.com|ytimg\.com)$/i;

/** CDN posture per host family: Bilibili's DASH video track is hotlink-gated
 *  (needs a bilibili Referer), Douyin's CDN keys off a mobile UA, and
 *  YouTube's ignores both but must not be read from a page origin. */
function proxyHeadersFor(hostname) {
  if (/(?:^|\.)bilivideo\.(?:com|cn)$|akamaized\.net$/i.test(hostname)) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Referer: 'https://www.bilibili.com/',
      Accept: '*/*',
    };
  }
  if (/googlevideo\.com$|ytimg\.com$/i.test(hostname)) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Referer: 'https://www.youtube.com/',
      Accept: '*/*',
    };
  }
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    Referer: 'https://www.douyin.com/',
    Accept: '*/*',
  };
}

/** Stream a media CDN response through the worker. Range requests pass
 *  through so the dashboard's resume logic keeps working; the body is
 *  piped, never buffered whole. A 30s idle timeout guards against hung
 *  upstreams without capping long healthy downloads. */
async function handleProxyDownload(request, target) {
  if (target.length > 2048) return json({ error: 'bad-url' }, 400);
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: 'bad-url' }, 400);
  }
  if (!/^https?:$/.test(parsed.protocol) || !PROXY_HOST.test(parsed.hostname)) {
    return json({ error: 'bad-url' }, 400);
  }

  const headers = proxyHeadersFor(parsed.hostname);
  const range = request.headers.get('range');
  if (range) headers.Range = range;

  let upstream;
  try {
    upstream = await fetch(target, { redirect: 'follow', headers });
  } catch {
    return json({ error: 'proxy-fetch-failed' }, 502);
  }
  if (!upstream.ok && upstream.status !== 206) {
    return json({ error: `upstream-${upstream.status}` }, 502);
  }

  const out = new Headers({
    'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Cache-Control': 'no-store',
  });
  for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export class MediaWorkerStore {
  constructor({ executor, ttlMs = DEFAULT_TTL_MS, maxTasks = DEFAULT_MAX_TASKS } = {}) {
    this.executor = executor ?? (async () => {
      throw failure('backend', 'media executor is not configured');
    });
    this.ttlMs = ttlMs;
    this.maxTasks = maxTasks;
    this.tasks = new Map();
    this.sequence = 0;
  }

  create(url) {
    this.cleanup();
    if (this.tasks.size >= this.maxTasks) throw failure('rate-limited', 'worker queue is full');
    const id = `media-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const controller = new AbortController();
    const task = { id, url, state: 'queued', controller, createdAt: Date.now() };
    this.tasks.set(id, task);
    void this.run(task);
    return task;
  }

  get(id) {
    this.cleanup();
    return this.tasks.get(id) ?? null;
  }

  cancel(id) {
    const task = this.get(id);
    if (!task) return null;
    if (task.state === 'queued' || task.state === 'running') {
      task.controller.abort();
      task.state = 'canceled';
      task.failure = failure('network', 'task canceled');
    }
    return task;
  }

  cleanup() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, task] of this.tasks) {
      if (task.createdAt < cutoff && (task.state === 'succeeded' || task.state === 'failed' || task.state === 'canceled')) {
        this.tasks.delete(id);
      }
    }
  }

  async run(task) {
    task.state = 'running';
    try {
      const result = await this.executor({ taskId: task.id, url: task.url, signal: task.controller.signal });
      if (task.controller.signal.aborted || task.state === 'canceled') return;
      task.result = result;
      task.state = 'succeeded';
    } catch (error) {
      if (task.controller.signal.aborted || task.state === 'canceled') return;
      task.failure = error?.reason ? error : failure('backend', error?.message ?? error);
      task.state = 'failed';
    }
  }
}

export function createMediaWorker(options = {}) {
  const store = new MediaWorkerStore(options);
  return {
    store,
    async handle(request) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
      const url = new URL(request.url ?? 'http://media-worker.local/');
      const headers = cors();

      if (url.pathname === '/health' && request.method === 'GET') {
        return json({ ok: true, service: 'media-worker', queueSize: store.tasks.size }, 200, headers);
      }

      const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const task = store.get(decodeURIComponent(taskMatch[1]));
        if (!task) return json({ error: 'not-found' }, 404, headers);
        if (request.method === 'GET') return json(taskView(task), 200, headers);
        if (request.method === 'DELETE') return json(taskView(store.cancel(task.id)), 202, headers);
      }

      if (url.pathname === '/download' && (request.method === 'GET' || request.method === 'HEAD')) {
        const target = url.searchParams.get('url') ?? '';
        if (!target) return json({ error: 'bad-url' }, 400, headers);
        return handleProxyDownload(request, target);
      }

      if (url.pathname === '/resolve' && request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad-json' }, 400, headers); }
        const pageUrl = typeof body?.url === 'string' ? body.url.trim() : '';
        if (!/^https?:\/\//i.test(pageUrl)) return json({ error: 'bad-url' }, 400, headers);
        try {
          const task = store.create(pageUrl);
          return json(taskView(task), 202, headers);
        } catch (error) {
          return json({ error: error?.reason ?? 'backend', detail: error?.detail ?? String(error) }, 429, headers);
        }
      }

      return json({ error: 'not-found' }, 404, headers);
    },
  };
}

function cors() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}
