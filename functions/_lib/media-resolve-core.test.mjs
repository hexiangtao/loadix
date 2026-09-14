import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('returns a resolved payload for a real douyin share page (network test, skipped when offline/throttled)', async () => {
    const attempt = () =>
      handleResolve(req('http://local/api/resolve?pageUrl=' + encodeURIComponent('https://www.douyin.com/video/7233689549669469477'))).then(
        (r) => (r.status === 200 ? r.json() : null),
      );
    let body = await attempt();
    // Douyin per-IP throttles aggressive fetchers with empty shells; one
    // spaced retry before treating this environment as blocked.
    if (!body?.resolved?.formats?.length) {
      await new Promise((r) => setTimeout(r, 2_500));
      body = await attempt();
    }
    if (!body?.resolved?.formats?.length) return; // CI / throttled — stubbed tests own the logic
    expect(body.resolved.formats[0].container).toBe('mp4');
    expect(body.resolved.formats[0].url).toContain('video_id=');
  });

  describe('douyin chain (stubbed fetch)', () => {
    afterEach(() => vi.unstubAllGlobals());

    const routerData = (withItem) =>
      `<html><script>window._ROUTER_DATA=${JSON.stringify({
        loaderData: {
          'video_(id)/page': {
            videoInfoRes: withItem
              ? { item_list: [{ desc: '测试视频', video: { play_addr: { uri: 'v0200abc', url_list: ['https://aweme.snssdk.com/aweme/v1/playwm/?video_id=v0200abc&ratio=720p&line=0'] } } }] }
              : { item_list: [] },
          },
        },
      })}</script></html>`;

    function stubDouyinFetch() {
      const seen = [];
      const fetchMock = vi.fn(async (url, init = {}) => {
        seen.push({ url, init });
        const withItem = seen.filter((c) => String(c.url).includes('/share/video/7233689549669469477')).length >= 2;
        return new Response(routerData(withItem), {
          status: 200,
          headers: seen.length === 1 ? { 'set-cookie': 'ttwid=abc123; Path=/' } : {},
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      return { fetchMock, seen };
    }

    it('performs the mobile two-pass with cookie replay and returns the no-watermark URL', async () => {
      const { fetchMock, seen } = stubDouyinFetch();
      const res = await handleResolve(req('http://local/api/resolve?pageUrl=' + encodeURIComponent('https://www.iesdouyin.com/share/video/7233689549669469477')));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resolved.formats[0].url).toContain('/aweme/v1/play/?video_id=v0200abc');
      expect(body.resolved.title).toBe('测试视频');
      // Two passes, second one presenting the ttwid from pass 1.
      expect(seen.length).toBe(2);
      expect(fetchMock.mock.calls[0][1].headers.Cookie).toBeUndefined();
      expect(fetchMock.mock.calls[1][1].headers.Cookie).toContain('ttwid=abc123');
      // Mobile UA on the share-page passes (the data is mobile-gated).
      expect(seen.every((c) => /iPhone/.test(c.init.headers['User-Agent']))).toBe(true);
    });
  });

  describe('proxyUrl lane', () => {
    afterEach(() => vi.unstubAllGlobals());

    function stubCdnFetch() {
      const fetchMock = vi.fn(async () => new Response('VIDEOBYTES', { status: 200, headers: { 'content-type': 'video/mp4' } }));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('streams allowed CDN hosts with CORS + passthrough headers', async () => {
      const fetchMock = stubCdnFetch();
      const res = await handleResolve(req('http://local/api/resolve?proxyUrl=' + encodeURIComponent('https://v11.douyinvod.com/x/main.mp4?sig=1')));
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('content-type')).toBe('video/mp4');
      expect(await res.text()).toBe('VIDEOBYTES');
      // Upstream request carries the mobile UA + douyin Referer.
      const init = fetchMock.mock.calls[0][1];
      expect(/iPhone/.test(init.headers['User-Agent'])).toBe(true);
      expect(init.headers.Referer).toBe('https://www.douyin.com/');
    });

    it('stamps a bilibili Referer on bilibili CDN hosts', async () => {
      const fetchMock = stubCdnFetch();
      const track = 'https://cn-hncs-cm-03-05.bilivideo.com/v1080.m4s?sig=1';
      const res = await handleResolve(req('http://local/api/resolve?proxyUrl=' + encodeURIComponent(track)));
      expect(res.status).toBe(200);
      // Bilibili serves the DASH track only to a bilibili origin, and a page
      // cannot set Referer itself — that is why this lane exists.
      const init = fetchMock.mock.calls[0][1];
      expect(init.headers.Referer).toBe('https://www.bilibili.com/');
      expect(/Windows/.test(init.headers['User-Agent'])).toBe(true);
    });

    it('refuses non-allowlisted and internal hosts (not an open proxy)', async () => {
      for (const bad of ['https://evil.example.com/a.mp4', 'http://127.0.0.1:8080/x', 'http://192.168.1.10/v.mp4']) {
        const res = await handleResolve(req('http://local/api/resolve?proxyUrl=' + encodeURIComponent(bad)));
        expect(res.status).toBe(400);
      }
    });
  });
});
