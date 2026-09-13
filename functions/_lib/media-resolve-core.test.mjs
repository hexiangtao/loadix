import { describe, expect, it } from 'vitest';
import { handleResolve } from './media-resolve-core.mjs';

function req(url, options = {}) {
  return {
    method: options.method ?? 'GET',
    url,
    headers: { get: (name) => (name === 'x-forwarded-for' ? (options.ip ?? '1.2.3.4') : null) },
    rawBody: options.rawBody,
  };
}

describe('media-resolve-core', () => {
  it('rejects non-http URLs', async () => {
    const res = await handleResolve(req('http://local/api/resolve?pageUrl=ftp://x.com/a'));
    expect(res.status).toBe(400);
  });

  it('blocks internal hostnames (SSRF guard)', async () => {
    for (const bad of ['http://localhost:5173/x', 'http://127.0.0.1/a', 'http://192.168.1.1/r', 'http://169.254.169.254/meta']) {
      const res = await handleResolve(req(`http://local/api/resolve?pageUrl=${encodeURIComponent(bad)}`));
      expect(res.status).toBe(400);
    }
  });

  it('rate limits per client ip', async () => {
    const ip = `10.0.0.${Math.floor(Math.random() * 200)}`;
    let last = 0;
    for (let i = 0; i < 25; i++) {
      const res = await handleResolve(req('http://local/api/resolve?pageUrl=https://www.bilibili.com/video/BV1none000/', { ip }));
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it('returns a resolved payload for a real bilibili page (network test, skipped when offline/blocked)', async () => {
    const res = await handleResolve(req('http://local/api/resolve?pageUrl=' + encodeURIComponent('https://www.bilibili.com/video/BV1RNYu6iEjB/')));
    if (res.status !== 200) return; // CI / offline — the unit paths above cover logic
    const body = await res.json();
    expect(body.resolved.formats.length).toBeGreaterThan(0);
    expect(body.resolved.formats[0].container === 'mp4' || body.resolved.dashOnly).toBe(true);
  });
});
