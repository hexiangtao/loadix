import { describe, expect, it, vi } from 'vitest';
import {
  extractUrlFromText,
  fetchableUrl,
  fileNameForCover,
  fileNameForFormat,
  fileNameForPart,
  originalImageUrl,
  partsFromWatchPage,
  preferredFormat,
  resolvePageUrl,
  titleFromWatchPage,
  withPartParam,
} from './mediaResolver';

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

  it('surfaces every part of a multi-part video instead of silently shipping the first', async () => {
    const pageUrl = 'https://www.bilibili.com/video/BV1parts/';
    const view = JSON.stringify({
      code: 0,
      data: {
        // The video's real title — the page's own <title> is the PART name.
        title: '双语访谈全集',
        pic: '//i0.hdslb.com/bfs/archive/cover.jpg',
        pages: [
          { page: 1, cid: 111, part: '双语字幕', duration: 120 },
          { page: 2, cid: 222, part: '无字幕', duration: 130 },
        ],
      },
    });
    const fetchText = stubFetch({
      [pageUrl]: bilibiliPage('222'),
      'https://api.bilibili.com/x/web-interface/view?bvid=BV1parts': view,
      'https://api.bilibili.com/x/player/playurl?bvid=BV1parts&cid=222&platform=html5&high_quality=1': playurl(16, 'https://cdn.bilivideo.com/p2.mp4', 10),
      __fallback: '__404',
    });

    const result = await resolvePageUrl(pageUrl, fetchText);
    expect(result.title).toBe('双语访谈全集');
    expect(result.cover).toBe('https://i0.hdslb.com/bfs/archive/cover.jpg');
    expect(result.parts?.map((part) => `${part.index}:${part.cid}:${part.title}`)).toEqual([
      '1:111:双语字幕',
      '2:222:无字幕',
    ]);
    // Formats are for the part the page actually served (the `?p=` selection).
    expect(result.formats.some((format) => format.url.includes('p2.mp4'))).toBe(true);
    // No `?p=` in the URL, so the ladder is part 1's — stated, not implied.
    expect(result.partIndex).toBe(1);
  });

  it('says which part the format ladder belongs to when the URL selects one', async () => {
    const pageUrl = 'https://www.bilibili.com/video/BV1parts/?p=2';
    const fetchText = stubFetch({
      [pageUrl]: bilibiliPage('222'),
      'https://api.bilibili.com/x/web-interface/view?bvid=BV1parts': JSON.stringify({
        code: 0,
        data: {
          title: '双语访谈全集',
          pages: [
            { page: 1, cid: 111, part: '双语字幕', duration: 120 },
            { page: 2, cid: 222, part: '无字幕', duration: 130 },
          ],
        },
      }),
      'https://api.bilibili.com/x/player/playurl?bvid=BV1parts&cid=222&platform=html5&high_quality=1': playurl(16, 'https://cdn.bilivideo.com/p2.mp4', 10),
      __fallback: '__404',
    });

    const result = await resolvePageUrl(pageUrl, fetchText);
    // A wrong answer here is how someone downloads P2 believing it is P1.
    expect(result.partIndex).toBe(2);
  });

  it('still finds every part when the metadata API refuses the request', async () => {
    // The live failure this guards against: the view API answered
    // 412 "request was banned" and the resolve silently reported a
    // single-part video, so the user downloaded P1 believing it was all of it.
    const pageUrl = 'https://www.bilibili.com/video/BV1blocked/?p=2';
    const page = `
<html><head><title>无字幕_哔哩哔哩_bilibili</title></head><body>
<h1 title="双语访谈全集 &amp; 加长版">…</h1>
<script>window.__INITIAL_STATE__={"videoData":{"pages":[{"cid":111,"page":1,"part":"双语字幕","duration":120,"dimension":{"width":1920,"height":1080}},{"cid":222,"page":2,"part":"无字幕","duration":130}],"bvid":"BV1blocked"},"other":[]};</script>
<script>window.__cid__="222";</script>
</body></html>`;
    const fetchText = stubFetch({
      [pageUrl]: page,
      __fallback: '__404',
    });

    const result = await resolvePageUrl(pageUrl, fetchText);
    expect(result.parts?.map((part) => `${part.index}:${part.cid}:${part.title}`)).toEqual([
      '1:111:双语字幕',
      '2:222:无字幕',
    ]);
    expect(result.partIndex).toBe(2);
    // The real title, not the part name the <title> tag carries.
    expect(result.title).toBe('双语访谈全集 & 加长版');
  });

  it('nests brackets correctly when mining the page for parts', () => {
    const html = '<script>{"pages":[{"cid":1,"page":1,"part":"a"},{"cid":2,"page":2,"part":"b"}],"next":[1]}</script>';
    expect(partsFromWatchPage(html)?.map((part) => part.cid)).toEqual(['1', '2']);
    // A single page is not a part list.
    expect(partsFromWatchPage('<script>{"pages":[{"cid":9,"page":1,"part":"only"}]}</script>')).toBeUndefined();
    // Malformed JSON must not throw into the resolve.
    expect(partsFromWatchPage('<script>{"pages":[{"cid":</script>')).toBeUndefined();
    expect(partsFromWatchPage('<html>no pages here</html>')).toBeUndefined();
  });

  it('points a watch URL at another part without losing its query', () => {
    expect(withPartParam('https://www.bilibili.com/video/BV1abc/?p=1&t=30', 4)).toBe(
      'https://www.bilibili.com/video/BV1abc/?p=4&t=30',
    );
    expect(withPartParam('https://www.bilibili.com/video/BV1abc/', 3)).toContain('p=3');
    // A URL we cannot parse is handed back untouched rather than mangled.
    expect(withPartParam('not a url', 2)).toBe('not a url');
  });

  it('names each part distinctly so a batch cannot overwrite itself', () => {
    expect(fileNameForPart('双语访谈全集', 1)).toBe('双语访谈全集 - P1.mp4');
    expect(fileNameForPart('双语访谈全集', 2)).not.toBe(fileNameForPart('双语访谈全集', 1));
  });

  it('reports no part list for a single-part video', async () => {
    const pageUrl = 'https://www.bilibili.com/video/BV1single/';
    const fetchText = stubFetch({
      [pageUrl]: bilibiliPage('400009'),
      'https://api.bilibili.com/x/web-interface/view?bvid=BV1single': JSON.stringify({
        code: 0,
        data: { title: 'Solo', pages: [{ page: 1, cid: 400009, part: 'only', duration: 10 }] },
      }),
      __fallback: '__404',
    });
    const result = await resolvePageUrl(pageUrl, fetchText);
    expect(result.parts).toBeUndefined();
  });

  it('uses the fnval=4048 DASH API for the audio track and for qualities the html5 API cannot grant', async () => {
    const pageUrl = 'https://www.bilibili.com/video/BV1dash404/';
    const fetchText = stubFetch({
      [pageUrl]: bilibiliPage('400004'),
      'https://api.bilibili.com/x/player/playurl?bvid=BV1dash404&cid=400004&platform=html5&high_quality=1': playurl(16, 'https://cdn.bilivideo.com/v360.mp4', 1000),
      'https://api.bilibili.com/x/player/playurl?bvid=BV1dash404&cid=400004&platform=pc&fnval=4048&qn=127&fnver=0&fourk=1': JSON.stringify({
        code: 0,
        data: {
          dash: {
            duration: 100,
            video: [
              { baseUrl: 'https://cdn.bilivideo.com/v1080.m4s', height: 1080, bandwidth: 800000 },
              { baseUrl: 'https://cdn.bilivideo.com/v360.m4s', height: 360, bandwidth: 100000 },
            ],
            audio: [
              { baseUrl: 'https://cdn.bilivideo.com/a192.m4s', bandwidth: 192000 },
              { baseUrl: 'https://cdn.bilivideo.com/a64.m4s', bandwidth: 64000 },
            ],
          },
        },
      }),
      __fallback: '__404',
    });

    const result = await resolvePageUrl(pageUrl, fetchText);
    // 1080p beats the muxed 360p the html5 API granted → offered, merged.
    const muxed = result.formats.filter((f) => f.container === 'dash-mux');
    expect(muxed.map((f) => f.quality)).toEqual(['1080p']);
    expect(muxed[0]!.companionUrl).toBe('https://cdn.bilivideo.com/a192.m4s');
    // 360p is already a complete MP4 — a merged row for it would be clutter.
    expect(muxed.some((f) => f.quality === '360p')).toBe(false);
    // The best audio track is offered on its own as a playable M4A.
    const audio = result.formats.filter((f) => f.container === 'dash-audio');
    expect(audio).toHaveLength(1);
    expect(audio[0]!.quality).toBe('192kbps');
    expect(audio[0]!.url).toBe('https://cdn.bilivideo.com/a192.m4s');
    // Sizes estimated from declared bandwidth × the manifest's own duration.
    expect(muxed[0]!.size).toBe(10_000_000 + 2_400_000);
    // Best quality leads, so the UI's "recommended" is never the worst file.
    expect(result.formats[0]!.quality).toBe('1080p');
  });

  it('pairs DASH video+audio into complete dash-mux rows when the API refuses', async () => {
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
    // DASH pairs are COMPLETE files (merged at download) — not a dead end.
    expect(result.dashOnly).toBe(false);
    expect(result.notice).toBe('');
    const muxed = result.formats.filter((f) => f.container === 'dash-mux');
    // Same height deduped to one option, sorted best first.
    expect(muxed.map((f) => f.quality)).toEqual(['1080p', '360p']);
    expect(muxed.every((f) => f.hasAudio)).toBe(true);
    expect(muxed[0]!.companionUrl).toBe('https://cdn.bilivideo.com/a.m4s');
    // No bare-track rows when every video could be paired.
    expect(result.formats.some((f) => f.container === 'dash-video')).toBe(false);
    expect(result.formats.some((f) => f.container === 'dash-audio')).toBe(false);
  });

  it('keeps bare DASH rows with a dash-only notice only when no audio exists to pair', async () => {
    const pageUrl = 'https://www.bilibili.com/video/BV1noaudio/';
    const fetchText = stubFetch({
      [pageUrl]: bilibiliPage('400003', {
        data: {
          dash: {
            video: [{ baseUrl: 'https://cdn.bilivideo.com/v720.m4s', height: 720, bandwidth: 2000000 }],
            audio: [],
          },
        },
      }),
      __fallback: '__404',
    });

    const result = await resolvePageUrl(pageUrl, fetchText);
    expect(result.dashOnly).toBe(true);
    expect(result.notice).toBe('dash-only');
    expect(result.formats.map((f) => f.container)).toEqual(['dash-video']);
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

/* ------------------------------------------------------------------ */
/* Douyin                                                              */
/* ------------------------------------------------------------------ */

const douyinShareHtml = (withItem: boolean, awemeId = '7233689549669469477'): string =>
  `<html><script>window._ROUTER_DATA=${JSON.stringify({
    loaderData: {
      'video_(id)/page': {
        videoInfoRes: withItem
          ? { item_list: [{ desc: '诶 有一点话 想要对你说', video: { play_addr: { uri: 'v0200fg10000chhjkjjc77u98dmhn5u0', url_list: [`https://aweme.snssdk.com/aweme/v1/playwm/?video_id=v0200fg10000chhjkjjc77u98dmhn5u0&ratio=720p&line=0`] } } }] }
          : { item_list: [] },
      },
    },
  })};</script></html>`;

describe('resolvePageUrl — douyin', () => {
  it('resolves the no-watermark MP4 from the mobile share page (two-pass)', async () => {
    const calls: string[] = [];
    const fetchText = vi.fn((url: string, _options?: { mobile?: boolean }) => {
      calls.push(url);
      // Pass 1: ttwid-less shell (empty item_list); pass 2: full item.
      return Promise.resolve(calls.length === 1 ? douyinShareHtml(false) : douyinShareHtml(true));
    });
    const resolved = await resolvePageUrl('https://www.douyin.com/video/7233689549669469477', fetchText);
    expect(resolved.formats).toHaveLength(1);
    const primary = resolved.formats[0]!;
    expect(primary.container).toBe('mp4');
    expect(primary.hasAudio).toBe(true);
    // No-watermark endpoint primary, watermarked as last-resort backup.
    expect(primary.url).toContain('/aweme/v1/play/?video_id=v0200fg10000chhjkjjc77u98dmhn5u0');
    expect(primary.backupUrls.some((u) => u.includes('/playwm/'))).toBe(true);
    expect(resolved.title).toBe('诶 有一点话 想要对你说');
    // Both passes hit the canonical share URL.
    expect(calls.every((u) => u.startsWith('https://www.iesdouyin.com/share/video/7233689549669469477'))).toBe(true);
    // The page fetcher must be told this is a mobile-gated site.
    expect(fetchText.mock.calls.every((call) => call[1]?.mobile === true)).toBe(true);
  });

  it('canonicalizes short-link style input once the id is discoverable', async () => {
    const fetchText = vi.fn((url: string) =>
      Promise.resolve(
        url.includes('/share/video/7345678901234567890')
          ? douyinShareHtml(true, '7345678901234567890')
          : '<html><body><a href="/video/7345678901234567890">landing</a></body></html>',
      ),
    );
    const resolved = await resolvePageUrl('https://v.douyin.com/iAbCdEf/', fetchText);
    expect(resolved.formats).toHaveLength(1);
    expect(resolved.formats[0]!.url).toContain('video_id=');
  });

  it('falls through to the generic scan when douyin yields nothing', async () => {
    const fetchText = stubFetch({
      __fallback: '<html><title>douyin</title><script src="x"></script><p>video.m3u8</p></html>',
    });
    const resolved = await resolvePageUrl('https://www.douyin.com/video/7233689549669469477', fetchText);
    expect(resolved.formats).toHaveLength(0);
    expect(resolved.notice).toBe('empty');
  });
});

describe('fetchableUrl — web proxy routing', () => {
  it('routes no-CORS douyin CDNs through the same-origin proxy on the web', () => {
    const proxied = fetchableUrl('https://v11.douyinvod.com/x/y/main.mp4?sig=1', false);
    expect(proxied).toBe('/api/resolve?proxyUrl=' + encodeURIComponent('https://v11.douyinvod.com/x/y/main.mp4?sig=1'));
    expect(fetchableUrl('https://v11.douyinvod.com/x/y/main.mp4?sig=1', true)).toBe('https://v11.douyinvod.com/x/y/main.mp4?sig=1');
  });

  it('leaves open-CDN hosts (bilibili) direct on both builds', () => {
    const url = 'https://upos-sz-mirror.bilivideo.com/v.mp4';
    expect(fetchableUrl(url, false)).toBe(url);
    expect(fetchableUrl(url, true)).toBe(url);
  });

  it('proxies only the Referer-gated bilibili track, never the open files', () => {
    const track = 'https://cn-hncs-cm-03-08.bilivideo.com/v1080.m4s';
    // The page cannot set Referer, and the CDN 403s without a bilibili one.
    expect(fetchableUrl(track, false, true)).toBe('/api/resolve?proxyUrl=' + encodeURIComponent(track));
    // The muxed MP4 and the audio track are open — no server bandwidth spent.
    expect(fetchableUrl(track, false)).toBe(track);
    // The extension carries a declarativeNetRequest rule instead.
    expect(fetchableUrl(track, true, true)).toBe(track);
  });
});

describe('fileNameForFormat', () => {
  it('builds clean, sanitized filenames', () => {
    const format = { key: 'mp4-64', container: 'mp4' as const, quality: '720p', hasAudio: true, size: 0, url: '', backupUrls: [] };
    expect(fileNameForFormat('My/Video: "Episode 1"?', format)).toBe('MyVideo Episode 1.mp4');
    // A bare video track is still an MP4, but must never be mistakable for
    // the complete file the user actually asked for.
    const dash = { ...format, container: 'dash-video' as const, quality: '1080p' };
    expect(fileNameForFormat('test', dash)).toBe('test-1080p-video.mp4');
    const hls = { ...format, container: 'hls' as const };
    expect(fileNameForFormat('test', hls)).toBe('test.ts');
  });

  it('keeps a batch from overwriting itself with the part label', () => {
    const format = { key: 'mp4-64', container: 'mp4' as const, quality: '720p', hasAudio: true, size: 0, url: '', backupUrls: [] };
    expect(fileNameForFormat('访谈', format, 'P2 无字幕')).toBe('访谈 - P2 无字幕.mp4');
  });

  it('names the audio track as a playable M4A and the poster as an image', () => {
    const format = { key: 'bili-audio', container: 'dash-audio' as const, quality: '192kbps', hasAudio: true, size: 0, url: '', backupUrls: [] };
    expect(fileNameForFormat('My Video', format)).toBe('My Video-audio.m4a');
    expect(fileNameForCover('My Video')).toBe('My Video-cover.jpg');
    expect(fileNameForCover('')).toBe('video-cover.jpg');
  });

  it('strips the image-processor directive so the original artwork is downloaded', () => {
    expect(originalImageUrl('https://i1.hdslb.com/bfs/archive/ab.jpg@1200w_630h')).toBe(
      'https://i1.hdslb.com/bfs/archive/ab.jpg',
    );
    expect(originalImageUrl('https://i1.hdslb.com/bfs/archive/ab.jpg')).toBe('https://i1.hdslb.com/bfs/archive/ab.jpg');
    // A query string is not an image directive.
    expect(originalImageUrl('https://x.com/a.jpg?w=100@2x')).toBe('https://x.com/a.jpg?w=100@2x');
  });
});

describe('preferredFormat', () => {
  const mp4 = (quality: string) => ({ key: quality, container: 'mp4' as const, quality, hasAudio: true, size: 0, url: '', backupUrls: [] });

  it('keeps one chosen quality across the parts of a batch', () => {
    const partFormats = [mp4('720p'), mp4('360p')];
    expect(preferredFormat(partFormats, { quality: '360p' })?.quality).toBe('360p');
  });

  it('falls back to the best available when a part lacks that quality', () => {
    expect(preferredFormat([mp4('360p')], { quality: '1080p' })?.quality).toBe('360p');
  });

  it('honours an audio-only choice', () => {
    const audio = { key: 'a', container: 'dash-audio' as const, quality: '192kbps', hasAudio: true, size: 0, url: '', backupUrls: [] };
    expect(preferredFormat([mp4('720p'), audio], { container: 'dash-audio' })?.container).toBe('dash-audio');
  });
});

describe('extractUrlFromText', () => {
  it('pulls the link out of share-sheet text', () => {
    const shareText = '【标题】 https://b23.tv/abc123?share_source=copy_web&vd_source=x';
    expect(extractUrlFromText(shareText)).toBe('https://b23.tv/abc123?share_source=copy_web&vd_source=x');
    expect(extractUrlFromText('https://www.bilibili.com/video/BV1RNYu6iEjB ，推荐')).toBe(
      'https://www.bilibili.com/video/BV1RNYu6iEjB',
    );
    expect(extractUrlFromText('   https://a.com/v.m3u8  ')).toBe('https://a.com/v.m3u8');
    // No URL at all — pass the trimmed text through for the caller to judge.
    expect(extractUrlFromText('  hello  ')).toBe('hello');
  });
});

describe('short links', () => {
  it('follows a b23.tv code to its canonical watch page', async () => {
    const seen: string[] = [];
    const fetchText = async (url: string) => {
      seen.push(url);
      return url.includes('b23.tv')
        ? '<html><title>b23</title></html>'
        : '<html><title>Real Video_哔哩哔哩</title><script>"cid":42</script></html>';
    };
    const fetchWithUrl = async (url: string) => ({ text: await fetchText(url), finalUrl: 'https://www.bilibili.com/video/BV1RNYu6iEjB/' });
    const resolved = await resolvePageUrl('https://b23.tv/abc123', fetchText, fetchWithUrl);
    expect(resolved.title).toBe('Real Video');
    expect(seen[0]).toBe('https://b23.tv/abc123');
  });

  it('falls back to the short URL when no redirect-reporting fetcher is given', async () => {
    const fetchText = async () => '<html><title>Short</title></html>';
    const resolved = await resolvePageUrl('https://b23.tv/abc123', fetchText);
    expect(resolved.title).toBe('Short');
  });
});
