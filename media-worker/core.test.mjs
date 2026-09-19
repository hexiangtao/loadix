import { describe, expect, it, vi } from 'vitest';
import { createMediaWorker } from './core.mjs';

const url = 'https://www.bilibili.com/video/BV1worker';

async function json(response) {
  return response.json();
}

async function waitFor(worker, taskId, expected) {
  for (let i = 0; i < 20; i++) {
    const response = await worker.handle(new Request(`http://worker.test/tasks/${taskId}`));
    const body = await json(response);
    if (body.state === expected) return body;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`task did not become ${expected}`);
}

describe('media worker protocol', () => {
  it('creates and completes a task through the HTTP contract', async () => {
    const worker = createMediaWorker({
      executor: async ({ url: input }) => ({
        title: 'resolved', pageUrl: input, formats: [], dashOnly: false, notice: 'empty',
      }),
    });
    const created = await worker.handle(new Request('http://worker.test/resolve', {
      method: 'POST', body: JSON.stringify({ url }), headers: { 'content-type': 'application/json' },
    }));
    expect(created.status).toBe(202);
    const task = await json(created);
    expect(task.taskId).toMatch(/^media-/);
    expect((await waitFor(worker, task.taskId, 'succeeded')).result.title).toBe('resolved');
  });

  it('returns a structured executor failure', async () => {
    const worker = createMediaWorker({
      executor: async () => { throw { reason: 'blocked', detail: 'upstream WAF' }; },
    });
    const created = await worker.handle(new Request('http://worker.test/resolve', {
      method: 'POST', body: JSON.stringify({ url }), headers: { 'content-type': 'application/json' },
    }));
    const task = await json(created);
    const failed = await waitFor(worker, task.taskId, 'failed');
    expect(failed.failure).toEqual({ reason: 'blocked', detail: 'upstream WAF' });
  });

  it('cancels a running task and delivers its abort signal', async () => {
    const aborted = vi.fn();
    const worker = createMediaWorker({
      executor: async ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { aborted(); resolve(null); }, { once: true });
      }),
    });
    const created = await worker.handle(new Request('http://worker.test/resolve', {
      method: 'POST', body: JSON.stringify({ url }), headers: { 'content-type': 'application/json' },
    }));
    const task = await json(created);
    const canceled = await worker.handle(new Request(`http://worker.test/tasks/${task.taskId}`, { method: 'DELETE' }));
    expect(canceled.status).toBe(202);
    expect((await json(canceled)).state).toBe('canceled');
    expect(aborted).toHaveBeenCalledOnce();
  });

  it('rejects invalid URLs and exposes health', async () => {
    const worker = createMediaWorker();
    const invalid = await worker.handle(new Request('http://worker.test/resolve', {
      method: 'POST', body: JSON.stringify({ url: 'file:///tmp/a' }), headers: { 'content-type': 'application/json' },
    }));
    expect(invalid.status).toBe(400);
    const health = await worker.handle(new Request('http://worker.test/health'));
    expect(await json(health)).toMatchObject({ ok: true, service: 'media-worker' });
  });
});
