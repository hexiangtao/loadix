import { describe, expect, it } from 'vitest';
import { extractMediaFromHtml } from './mediaScrape';

const bilibiliHtml = (playinfo: unknown): string =>
  `<html><head><title>【原神】PV</title></head><body><script>window.__playinfo__=${JSON.stringify(playinfo)}</script><script>console.log(1)</script></body></html>`;

describe('mediaScrape — bilibili __playinfo__', () => {
  it('extracts DASH video and audio tracks', () => {
    const html = bilibiliHtml({
      data: {
        dash: {
          video: [
            { baseUrl: 'https://upos-sz-mirror08c.bilivideo.com/30216/mda-xxx/video-1080.m4s?e=1', width: 1920, height: 1080, bandwidth: 4000000 },
            { baseUrl: 'https://upos-sz-mirror08c.bilivideo.com/30216/mda-xxx/video-360.m4s?e=2', width: 640, height: 360, bandwidth: 400000 },
          ],
          audio: [{ baseUrl: 'https://upos-sz-mirror08c.bilivideo.com/30216/mda-xxx/audio.m4s?e=3', bandwidth: 320000 }],
        },
      },
    });
    const assets = extractMediaFromHtml(html, 'https://www.bilibili.com/video/BV1RN/');

    const videos = assets.filter((a) => a.kind === 'video');
    const audios = assets.filter((a) => a.kind === 'audio');
    expect(videos).toHaveLength(2);
    expect(audios).toHaveLength(1);
    // Sorted best-first: 1080p row exists with a human name.
    expect(videos[0]!.fileName).toContain('1080p');
    expect(videos[0]!.container).toBe('dash');
    expect(audios[0]!.fileName).toContain('audio');
  });

  it('extracts legacy durl direct files', () => {
    const html = bilibiliHtml({
      data: { durl: [{ url: 'https://upos.bilivideo.com/mda-xxx.mp4?e=9', size: 12345678 }] },
    });
    const assets = extractMediaFromHtml(html, 'https://www.bilibili.com/video/BV1RN/');
    expect(assets).toHaveLength(1);
    expect(assets[0]!.kind).toBe('video');
    expect(assets[0]!.container).toBe('file');
    expect(assets[0]!.size).toBe(12345678);
  });

  it('survives malformed playinfo JSON', () => {
    const html = '<script>window.__playinfo__={broken json!!</script>';
    expect(extractMediaFromHtml(html, 'https://www.bilibili.com/x/')).toEqual([]);
  });
});

describe('mediaScrape — generic scan', () => {
  it('finds m3u8 and mp4 URLs in markup', () => {
    const html = `
      <script>var src = "https://cdn.example.com/hls/master.m3u8?token=abc";</script>
      <video src='https://cdn.example.com/clip.mp4'></video>
      <a href="https://example.com/page">not media</a>
    `;
    const assets = extractMediaFromHtml(html, 'https://example.com/watch');
    const urls = assets.map((a) => a.url);
    expect(urls.some((u) => u.includes('master.m3u8'))).toBe(true);
    expect(urls.some((u) => u.includes('clip.mp4'))).toBe(true);
    expect(urls).toHaveLength(2);
  });

  it('deduplicates repeated URLs', () => {
    const html = '<script>a="https://cdn.x.com/v.m3u8";b="https://cdn.x.com/v.m3u8";</script>';
    const assets = extractMediaFromHtml(html, 'https://x.com/');
    expect(assets).toHaveLength(1);
  });

  it('returns empty for pages with no media', () => {
    const html = '<html><body><p>hello</p></body></html>';
    expect(extractMediaFromHtml(html, 'https://example.com/')).toEqual([]);
  });
});
