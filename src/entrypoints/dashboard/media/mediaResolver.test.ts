import { describe, expect, it, vi } from 'vitest';
import { fileNameForFormat, resolvePageUrl } from './mediaResolver';

/** Stub fetch: maps URL → body text, records calls. */
function stubFetch(routes: Record<string, string>) {
  return vi.fn((url: string) => {
    const body = routes[url] ?? routes.__fallback ?? '';
    if (body === '__404') return Promise.reject(new Error('HTTP 404'));
    return Promise.resolve(body);
  });
}

const bilibiliPage = (cid: string, playinfo?: unknown): string => `
<html><head><title>【Test】Sample video_哔哩哔哩_bilibili</title></head><body>
<script>window.__cid__="${cid}";var x={"cid":${cid}};</script>
${playinfo ? `<script>window.__playinfo__=${JSON.stringify(playinfo)}</script>` : ''}
</body></html>`;

const playurl = (quality: number, url: string, size = 0): string =>
  JSON.stringify({ code: 0, data: { quality, accept_quality: [64, 32, 16], durl: [{ url, size, backup_url: [url + '.bak'] }] } });

describe('resolvePageUrl — bilibili', () => {
  it('resolves muxed MP4 formats from the html5 playurl API', async () => {
    const pageUrl = 'https://www.bilibili.com/video/BV1abc123/';
    const fetchText = stubFetch({
      [pageUrl]: bilibiliPage('400001'),
      'https://api.bilibili.com/x/player/playurl?bvid=BV1abc123&cid=400001&platform=html5&high_quality=1': playurl(64, 'https://cdn.bilivideo.com/v720.mp4', 1048576),
      'https://api.bilibili.com/x/player/playurl?bvid=BV1abc123&cid=400001&platform=html5&qn=32': playurl(32, 'https://cdn.bilivideo.com/v480.mp4'),
      'https://api.bilibili.com/x/player/playurl?bvid=BV1abc123&cid=400001&platform=html5&qn=16': playurl(16, 'https://cdn.bilivideo.com/v360.mp4'),
    });

    const result = await resolvePageUrl(pageUrl, fetchText);
    expect(result.dashOnly).toBe(false);
    expect(result.notice).toBe('');
    expect(result.title).toContain('Sample video');
    const mp4s = result.formats.filter((f) => f.container === 'mp4');
    expect(mp4s.map((f) => f.quality)).toEqual(['720p', '480p', '360p']);
    expect(mp4s.every((f) => f.hasAudio)).toBe(true);
    expect(mp4s[0]!.size).toBe(1048576);
    expect(mp4s[0]!.backupUrls).toHaveLength(1);
  });

  it('falls back to DASH tracks with a dash-only notice when the API refuses', async () => {
    const pageUrl = 'https://www.bilibili.com/video/BV1dash999/';
    const fetchText = stubFetch({
      [pageUrl]: bilibiliPage('400002', {
        data: {
          dash: {
            video: [
              { baseUrl: 'https://cdn.bilivideo.com/v1080.m4s', height: 1080, bandwidth: 5000000 },
              { baseUrl: 'https://cdn.bilivideo.com/v1080-codec2.m4s', height: 1080, bandwidth: 4500000 },
              { baseUrl: 'https://cdn.bilivideo.com/v360.m4s', height: 360, bandwidth: 400000 },
            ],
            audio: [{ baseUrl: 'https://cdn.bilivideo.com/a.m4s', bandwidth: 320000 }],
          },
        },
      }),
      __fallback: '__404',
    });

    const result = await resolvePageUrl(pageUrl, fetchText);
    expect(result.dashOnly).toBe(true);
    expect(result.notice).toBe('dash-only');
    const dashVideos = result.formats.filter((f) => f.container === 'dash-video');
    // Same height deduped to one option, sorted best first.
    expect(dashVideos.map((f) => f.quality)).toEqual(['1080p', '360p']);
    expect(dashVideos.every((f) => !f.hasAudio)).toBe(true);
    expect(result.formats.some((f) => f.container === 'dash-audio')).toBe(true);
  });

  it('reports empty when nothing is extractable', async () => {
    const pageUrl = 'https://www.bilibili.com/video/BV1none000/';
    const fetchText = stubFetch({ [pageUrl]: '<html><body>login required</body></html>', __fallback: '__404' });
    const result = await resolvePageUrl(pageUrl, fetchText);
    expect(result.notice).toBe('empty');
    expect(result.formats).toHaveLength(0);
  });
});

describe('resolvePageUrl — generic sites', () => {
  it('finds direct media URLs in any page', async () => {
    const pageUrl = 'https://example.com/watch';
    const fetchText = stubFetch({
      [pageUrl]: `<script>var s="https://cdn.example.com/movie.mp4?token=1";var h='https://cdn.example.com/v/index.m3u8';</script>`,
    });
    const result = await resolvePageUrl(pageUrl, fetchText);
    expect(result.formats.map((f) => f.container).sort()).toEqual(['hls', 'mp4']);
    expect(result.notice).toBe('');
  });
});

describe('fileNameForFormat', () => {
  it('builds clean, sanitized filenames', () => {
    const format = { key: 'mp4-64', container: 'mp4' as const, quality: '720p', hasAudio: true, size: 0, url: '', backupUrls: [] };
    expect(fileNameForFormat('My/Video: "Episode 1"?', format)).toBe('MyVideo Episode 1.mp4');
    const dash = { ...format, container: 'dash-video' as const, quality: '1080p' };
    expect(fileNameForFormat('test', dash)).toBe('test-1080p.m4s');
    const hls = { ...format, container: 'hls' as const };
    expect(fileNameForFormat('test', hls)).toBe('test.ts');
  });
});
