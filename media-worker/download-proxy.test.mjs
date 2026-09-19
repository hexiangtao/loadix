import { describe, expect, it } from 'vitest';
import { createMediaWorker } from './core.mjs';

const CDN_URL = 'https://cdn.bilivideo.com/video-720.m4s';

function workerWith(upstream) {
  return createMediaWorker({
    executor: async () => { throw { reason: 'backend', detail: 'unused' }; },
    fetchImpl: upstream,
  });
}

function injectFetch(worker, impl) {
  // core.mjs calls global fetch inside handleProxyDownload; patch per test.
  globalThis.fetch = impl;
  return worker;
}

describe('worker /download streaming proxy', () => {
  it('streams an upstream response with exposed range headers', async () => {
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk-one-'));
        controller.enqueue(new TextEncoder().encode('chunk-two'));
        controller.close();
      },
    });
    const upstream = new Response(upstreamBody, {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': 'bytes 0-17/1000',
        'Content-Length': '18',
        'Accept-Ranges': 'bytes',
      },
    });
    let seenUrl = '';
    let seenHeaders;
    injectFetch(undefined, (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers;
      return Promise.resolve(upstream);
    });
    const worker = createMediaWorker();

    const response = await worker.handle(new Request(`http://worker.test/download?url=${encodeURIComponent(CDN_URL)}`, {
      headers: { Range: 'bytes=0-17' },
    }));
    expect(response.status).toBe(206);
    expect(seenUrl).toBe(CDN_URL);
    expect(seenHeaders.Range).toBe('bytes=0-17');
    expect(seenHeaders.Referer).toBe('https://www.bilibili.com/');
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-range')).toBe('bytes 0-17/1000');
    const text = await new Response(response.body).text();
    expect(text).toBe('chunk-one-chunk-two');
  });

  it('refuses non-CDN and non-http targets', async () => {
    const worker = createMediaWorker();
    const evil = await worker.handle(new Request(`http://worker.test/download?url=${encodeURIComponent('https://evil.example.com/x.mp4')}`));
    expect(evil.status).toBe(400);
    const internal = await worker.handle(new Request(`http://worker.test/download?url=${encodeURIComponent('http://127.0.0.1:8080/admin')}`));
    expect(internal.status).toBe(400);
  });

  it('maps an upstream refusal to a structured 502', async () => {
    injectFetch(undefined, () => Promise.resolve(new Response('forbidden', { status: 403 })));
    const worker = createMediaWorker();
    const response = await worker.handle(new Request(`http://worker.test/download?url=${encodeURIComponent(CDN_URL)}`));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstream-403' });
  });
});
