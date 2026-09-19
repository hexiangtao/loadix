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
