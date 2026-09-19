import { describe, expect, it, vi } from 'vitest';
import { md5Hex } from '../tools/md5';
import {
  extractUrlFromText,
  fetchableUrl,
  fileNameForCover,
  fileNameForFormat,
  fileNameForPart,
  originalImageUrl,
  partsFromWatchPage,
  preferredFormat,
  mixinKeyForBilibili,
  resolvePageUrl,
  signBilibiliParams,
  SUPPORTED_PLATFORMS,
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

describe('Bilibili WBI signing', () => {
  it('uses the RFC MD5 digest required by WBI', () => {
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('uses the documented WBI mixin key', () => {
    expect(mixinKeyForBilibili('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45')).toBe('ea1db124af3c7062474693fa704f4ff8');
  });

  it('creates a sorted, encoded query with an MD5 WBI suffix', () => {
    const signed = signBilibiliParams({ foo: '114', bar: '514', baz: 1919810 }, '7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45', 1702204169);
    const query = 'bar=514&baz=1919810&foo=114&wts=1702204169';
    expect(signed).toBe(`${query}&w_rid=${md5Hex(query + mixinKeyForBilibili('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45'))}`);
  });
});

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

  it('proxies YouTube bytes, which carry no Access-Control-Allow-Origin', () => {
    // The extension downloads googlevideo directly; the web build cannot read
    // that response from a page origin at all (verified: `Vary: Origin` and
    // `Cross-Origin-Resource-Policy: cross-origin`, but no ACAO header), so its
    // bytes have to come through this origin like Douyin's already do.
    expect(fetchableUrl('https://rr2---sn-x.googlevideo.com/videoplayback?itag=18', false)).toBe(
      '/api/resolve?proxyUrl=https%3A%2F%2Frr2---sn-x.googlevideo.com%2Fvideoplayback%3Fitag%3D18',
    );
    expect(fetchableUrl('https://i.ytimg.com/vi_webp/aqz-KE-bpKQ/sddefault.webp', false)).toContain('/api/resolve?proxyUrl=');
    expect(fetchableUrl('https://rr2---sn-x.googlevideo.com/videoplayback?itag=18', true)).toBe(
      'https://rr2---sn-x.googlevideo.com/videoplayback?itag=18',
    );
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

/* ------------------------------------------------------------------ */
/* AcFun (site adapter)                                                */
/* ------------------------------------------------------------------ */

/** AcFun's real page shape: `ksPlayJson` is a JSON *string* inside a JSON
 *  blob inside a <script>, so the fixture reproduces that escaping exactly
 *  rather than hand-writing it (which is how it would drift from reality). */
const acfunPage = (representations: unknown[], title = '乌军展示新装备的歼10CE'): string =>
  `<html><head><title>${title} - AcFun弹幕视频网 ( ゜- ゜)つロ</title></head><body>
   <h1 class="title"><span>${title}</span></h1>
   <script>window.pageInfo = ${JSON.stringify({
     currentVideoInfo: {
       priority: 0,
       ksPlayJson: JSON.stringify({
         version: '1.0.0',
         videoId: '08e1f4da6fb0a4c4',
         adaptationSet: [{ id: 0, duration: 660200, representation: representations }],
       }),
     },
   })};</script></body></html>`;

const acfunRep = (height: number, frameRate: number, codecs = 'avc1.640033') => ({
  id: 1,
  url: `https://tx-safety-video.acfun.cn/mediacloud/x-${height}-${frameRate}.m3u8?pkey=t`,
  backupUrl: [`https://ali-safety-video.acfun.cn/mediacloud/x-${height}-${frameRate}.m3u8?pkey=a`],
  width: Math.round((height * 16) / 9),
  height,
  frameRate,
  codecs,
  qualityType: `${height}p${frameRate > 30 ? frameRate : ''}`,
  qualityLabel: `${height}P${frameRate > 30 ? frameRate : ''}`,
});

describe('resolvePageUrl — AcFun', () => {
  it('resolves one HLS row per quality, with the mirror CDN as backup', async () => {
    const pageUrl = 'https://www.acfun.cn/v/ac48825923';
    const fetchText = stubFetch({
      [pageUrl]: acfunPage([
        acfunRep(1080, 60),
        acfunRep(1080, 30),
        acfunRep(720, 30),
        acfunRep(540, 30),
        acfunRep(360, 30),
      ]),
    });
    const resolved = await resolvePageUrl(pageUrl, fetchText);

    // AcFun is HLS with its own audio, so every row is a complete file and
    // none of them can be "dash-only". Two 1080 representations collapsed
    // into one row — the 60fps one.
    expect(resolved.title).toBe('乌军展示新装备的歼10CE');
    expect(resolved.formats.map((format) => format.quality)).toEqual(['1080P60', '720P', '540P', '360P']);
    expect(resolved.formats.every((format) => format.container === 'hls' && format.hasAudio)).toBe(true);
    expect(resolved.dashOnly).toBe(false);
    expect(resolved.notice).toBe('');
    expect(resolved.formats[0]!.url).toContain('tx-safety-video.acfun.cn');
    expect(resolved.formats[0]!.backupUrls[0]).toContain('ali-safety-video.acfun.cn');
  });

  it('prefers H.264 over a higher frame rate at the same height', async () => {
    const pageUrl = 'https://www.acfun.cn/v/ac48825923';
    const fetchText = stubFetch({
      [pageUrl]: acfunPage([
        { ...acfunRep(1080, 60, 'hev1.1.6.L120.90'), qualityType: '1080p60', qualityLabel: '1080P60' },
        { ...acfunRep(1080, 30, 'avc1.640033'), qualityType: '1080p', qualityLabel: '1080P' },
      ]),
    });
    const resolved = await resolvePageUrl(pageUrl, fetchText);

    // One row for 1080: the H.264 one, because it plays anywhere.
    expect(resolved.formats).toHaveLength(1);
    expect(resolved.formats[0]!.url).toContain('-1080-30');
  });

  it('handles the mobile share shape (?ac=)', async () => {
    const pageUrl = 'https://m.acfun.cn/v/?ac=48825923';
    const fetchText = stubFetch({ [pageUrl]: acfunPage([acfunRep(720, 30)]) });
    const resolved = await resolvePageUrl(pageUrl, fetchText);
    expect(resolved.formats).toHaveLength(1);
  });

  it('does not claim a lookalike host', async () => {
    const fetchText = stubFetch({ __fallback: '<html><title>nope</title></html>' });
    const resolved = await resolvePageUrl('https://acfun.cn.evil.com/v/ac48825923', fetchText);
    expect(resolved.formats).toHaveLength(0);
    expect(resolved.notice).toBe('empty');
  });

  it('falls through to the generic scan when the page has no play info', async () => {
    const pageUrl = 'https://www.acfun.cn/v/ac48825923';
    const fetchText = stubFetch({
      [pageUrl]: '<html><title>AcFun</title><p>https://cdn.example.com/backup.mp4</p></html>',
    });
    const resolved = await resolvePageUrl(pageUrl, fetchText);
    expect(resolved.formats.map((format) => format.url)).toEqual(['https://cdn.example.com/backup.mp4']);
  });
});

/* ------------------------------------------------------------------ */
/* Bilibili 番剧 / 课程 (site adapter)                                  */
/* ------------------------------------------------------------------ */

/** Real values: PGC reports length in MILLISECONDS (this episode is 48:57),
 *  unlike a /video/ page's 分P which are in seconds. */
const PGC_EPISODES = [
  { id: 826497, cid: 1602741036, long_title: '为了消灭鬼舞辻无惨', duration: 2937220 },
  { id: 826498, cid: 1602741037, long_title: '水柱·富冈义勇的痛楚', duration: 1435000 },
];

const pgcSeason = (episodes: unknown[]) =>
  JSON.stringify({
    code: 0,
    result: { title: '鬼灭之刃 柱训练篇', cover: '//i0.hdslb.com/bfs/archive/cover.jpg', episodes },
  });

/** Real PGC tracks: snake_case mirrors of every field, plus a measured
 *  `size` that the `x/player` endpoint does not provide. */
const pgcPlayurl = (video: unknown[], audio: unknown[]) =>
  JSON.stringify({ code: 0, result: { dash: { video, audio } } });

const PGC_VIDEO = [
  { id: 32, base_url: 'https://cn-jsnt.bilivideo.com/v-480.m4s', baseUrl: 'https://cn-jsnt.bilivideo.com/v-480.m4s', backup_url: ['https://upos.bilivideo.com/v-480.m4s'], height: 480, bandwidth: 502934, size: 12345678, codecs: 'avc1.64001F' },
  { id: 16, base_url: 'https://cn-jsnt.bilivideo.com/v-360.m4s', baseUrl: 'https://cn-jsnt.bilivideo.com/v-360.m4s', height: 360, bandwidth: 301212, size: 7654321, codecs: 'avc1.64001E' },
];
const PGC_AUDIO = [{ id: 30280, base_url: 'https://cn-jsnt.bilivideo.com/a.m4s', baseUrl: 'https://cn-jsnt.bilivideo.com/a.m4s', bandwidth: 191304, size: 2345678 }];

const pgcRoutes = (season: string, play: string) => ({
  'https://api.bilibili.com/pgc/view/web/season?ep_id=826497': season,
  'https://api.bilibili.com/pgc/view/web/season?season_id=47836': season,
  'https://api.bilibili.com/pgc/player/web/playurl?ep_id=826497&fnval=4048&qn=127&fnver=0&fourk=1': play,
});

describe('resolvePageUrl — bilibili 番剧 (PGC)', () => {
  it('resolves the episode ladder and the whole season as parts', async () => {
    const pageUrl = 'https://www.bilibili.com/bangumi/play/ep826497';
    const fetchText = stubFetch(pgcRoutes(pgcSeason(PGC_EPISODES), pgcPlayurl(PGC_VIDEO, PGC_AUDIO)));
    const resolved = await resolvePageUrl(pageUrl, fetchText);

    expect(resolved.title).toBe('鬼灭之刃 柱训练篇');
    expect(resolved.cover).toBe('https://i0.hdslb.com/bfs/archive/cover.jpg');
    expect(resolved.formats.map((format) => format.quality)).toEqual(['480p', '360p', '191kbps']);
    // Video+audio merge into ONE playable file, which is the product promise.
    expect(resolved.formats[0]!.container).toBe('dash-mux');
    expect(resolved.formats[0]!.companionUrl).toContain('/a.m4s');
    // Sizes come from the declared byte count, not a bandwidth guess.
    expect(resolved.formats[0]!.size).toBe(12345678 + 2345678);
    expect(resolved.formats[0]!.requiresReferer).toBe(true);
    // dash-mux rows ARE complete files (the two tracks are merged on
    // download), so this is not a "video-only" result and must not be
    // labelled as one.
    expect(resolved.dashOnly).toBe(false);
    expect(resolved.notice).toBe('');

    // A season IS a part list — and each episode is its own URL, which is
    // what lets the batch downloader reach the others.
    expect(resolved.parts?.map((part) => part.title)).toEqual(['为了消灭鬼舞辻无惨', '水柱·富冈义勇的痛楚']);
    expect(resolved.parts?.[1]?.url).toBe('https://www.bilibili.com/bangumi/play/ep826498');
    expect(resolved.partIndex).toBe(1);
    // ms → s, or the UI renders "816:07:40" for a 49-minute episode.
    expect(resolved.parts?.[0]?.durationSeconds).toBe(2937);
    // A TV season has episodes, and the copy has to say so.
    expect(resolved.partsLabel).toBe('episodes');
  });

  it('resolves a season URL to its first episode', async () => {
    const pageUrl = 'https://www.bilibili.com/bangumi/play/ss47836';
    const fetchText = stubFetch(pgcRoutes(pgcSeason(PGC_EPISODES), pgcPlayurl(PGC_VIDEO, PGC_AUDIO)));
    const resolved = await resolvePageUrl(pageUrl, fetchText);

    expect(resolved.partIndex).toBe(1);
    expect(resolved.formats.length).toBeGreaterThan(0);
    // Every episode URL keeps the season's own origin and path prefix.
    expect(resolved.parts?.[0]?.url).toBe('https://www.bilibili.com/bangumi/play/ep826497');
  });

  it('names a single-episode page after the episode, not just the series', async () => {
    const pageUrl = 'https://www.bilibili.com/bangumi/play/ep826497';
    const fetchText = stubFetch(pgcRoutes(pgcSeason([PGC_EPISODES[0]!]), pgcPlayurl(PGC_VIDEO, PGC_AUDIO)));
    const resolved = await resolvePageUrl(pageUrl, fetchText);

    // With no list to disambiguate, the title has to say which episode.
    expect(resolved.title).toBe('鬼灭之刃 柱训练篇 - 为了消灭鬼舞辻无惨');
    expect(resolved.parts).toBeUndefined();
  });

  it('falls back to the generic scan when the season API refuses', async () => {
    const pageUrl = 'https://www.bilibili.com/bangumi/play/ep826497';
    const fetchText = stubFetch({ __fallback: '<html><title>番剧</title></html>' });
    const resolved = await resolvePageUrl(pageUrl, fetchText);
    expect(resolved.formats).toHaveLength(0);
    expect(resolved.notice).toBe('empty');
  });
});

describe('resolvePageUrl — generic sites', () => {
  it('reads a schema.org VideoObject', async () => {
    const pageUrl = 'https://news.example.com/story';
    const fetchText = stubFetch({
      [pageUrl]: `<html><head><title>报道</title>
        <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
          {"@type":"Article","name":"outer"},
          {"@type":"VideoObject","name":"示例影片","contentUrl":"https://cdn.example.com/feature.mp4?token=9","thumbnailUrl":"https://cdn.example.com/poster.jpg"}
        ]}</script></head></html>`,
    });
    const resolved = await resolvePageUrl(pageUrl, fetchText);

    expect(resolved.formats.map((format) => format.url)).toEqual(['https://cdn.example.com/feature.mp4?token=9']);
    expect(resolved.title).toBe('示例影片');
    expect(resolved.cover).toBe('https://cdn.example.com/poster.jpg');
  });

  it('reads og:video but never an embed page', async () => {
    const pageUrl = 'https://www.example.com/watch';
    const fetchText = stubFetch({
      [pageUrl]: `<html><head>
        <meta property="og:video" content="https://player.example.com/embed/12345" />
        <meta property="og:video:secure_url" content="https://cdn.example.com/og.mp4" />
      </head></html>`,
    });
    const resolved = await resolvePageUrl(pageUrl, fetchText);

    // The embed URL is a player page, not a file: offering it would hand the
    // user a download that is really an HTML document.
    expect(resolved.formats.map((format) => format.url)).toEqual(['https://cdn.example.com/og.mp4']);
  });

  it('reads a Maccms player_aaaa config, which is what most CN CMS sites embed', async () => {
    const pageUrl = 'https://www.example.com/play/123';
    const fetchText = stubFetch({
      [pageUrl]: `<html><title>剧集</title>
        <script>var player_aaaa={"flag":"play","encrypt":0,"url":"https://cdn.example.com/cms/index.m3u8"};</script></html>`,
    });
    const resolved = await resolvePageUrl(pageUrl, fetchText);

    expect(resolved.formats).toHaveLength(1);
    expect(resolved.formats[0]!.container).toBe('hls');
  });

  it('reads a plain <video> element', async () => {
    const pageUrl = 'https://blog.example.com/post';
    const fetchText = stubFetch({
      [pageUrl]: '<html><title>博文</title><video controls src="https://cdn.example.com/clip.mp4"></video></html>',
    });
    const resolved = await resolvePageUrl(pageUrl, fetchText);
    expect(resolved.formats.map((format) => format.url)).toEqual(['https://cdn.example.com/clip.mp4']);
  });

  it('does not offer a DASH manifest it cannot mux', async () => {
    const pageUrl = 'https://www.example.com/dash';
    const fetchText = stubFetch({ [pageUrl]: '<html><title>dash</title><p>https://cdn.example.com/stream.mpd</p></html>' });
    const resolved = await resolvePageUrl(pageUrl, fetchText);

    // Downloading an .mpd would save an XML file named video.mp4.
    expect(resolved.formats).toHaveLength(0);
    expect(resolved.notice).toBe('empty');
  });
});

describe('resolvePageUrl — YouTube', () => {
  const WATCH = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

  /** A real player response, trimmed: the muxed 360p entry plus the adaptive
   *  tracks YouTube offers (and that its CDN will not actually serve). */
  const playerResponse = {
    playabilityStatus: { status: 'OK' },
    videoDetails: {
      title: 'Big Buck Bunny 60fps 4K',
      author: 'Blender',
      lengthSeconds: '635',
      thumbnail: {
        thumbnails: [
          { url: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/default.jpg', width: 120 },
          { url: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/maxresdefault.jpg', width: 1920 },
        ],
      },
    },
    streamingData: {
      formats: [
        {
          // No contentLength AND no `clen` in the URL — exactly what YouTube
          // returns for the muxed format (copied from a live response).
          itag: 18,
          url: 'https://rr2---sn-x.googlevideo.com/videoplayback?itag=18&dur=634.624&sig=abc',
          mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
          qualityLabel: '360p',
          audioQuality: 'AUDIO_QUALITY_LOW',
        },
      ],
      adaptiveFormats: [
        {
          itag: 298,
          url: 'https://rr2---sn-x.googlevideo.com/videoplayback?itag=298&clen=150524867',
          mimeType: 'video/mp4',
          qualityLabel: '720p60',
          height: 720,
          contentLength: '150524867',
        },
        {
          itag: 140,
          url: 'https://rr2---sn-x.googlevideo.com/videoplayback?itag=140&clen=10271496',
          mimeType: 'audio/mp4',
          contentLength: '10271496',
        },
      ],
    },
  };

  /** Fetcher that records the options each call was made with. */
  function playerFetch(response: unknown, mode: 'json' | 'reject' = 'json') {
    const calls: { url: string; options?: { method?: string; body?: string; headers?: Record<string, string> } }[] = [];
    const fetchText = (url: string, options?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      calls.push({ url, options });
      // Only the player endpoint fails when asked to; the watch page still
      // loads, which is the real shape of "YouTube is not reachable from here".
      if (mode === 'reject' && url.includes('/youtubei/')) return Promise.reject(new Error('HTTP 403'));
      if (mode === 'reject') return Promise.resolve('<html><title>Big Buck Bunny</title></html>');
      return Promise.resolve(JSON.stringify(response));
    };
    return { calls, fetchText };
  }

  it('resolves the pre-muxed complete file, asking as the ANDROID client', async () => {
    const { calls, fetchText } = playerFetch(playerResponse);
    const resolved = await resolvePageUrl(WATCH, fetchText);

    expect(resolved.formats).toHaveLength(1);
    const [only] = resolved.formats;
    expect(only!.container).toBe('mp4');
    expect(only!.quality).toBe('360p');
    // Decided from the codec string (`mp4a` is in there), not assumed.
    expect(only!.hasAudio).toBe(true);
    // The muxed entry declares no size at all, so the row says "unknown"
    // instead of guessing; the download fills the real number in.
    expect(only!.size).toBe(0);
    expect(resolved.title).toBe('Big Buck Bunny 60fps 4K');
    expect(resolved.cover).toBe('https://i.ytimg.com/vi/aqz-KE-bpKQ/maxresdefault.jpg');
    expect(resolved.notice).toBe('sd-only');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/youtubei/v1/player');
    expect(calls[0]!.options?.method).toBe('POST');
    expect(calls[0]!.options?.headers?.['X-YouTube-Client-Name']).toBe('3');
    const body = JSON.parse(calls[0]!.options!.body!) as {
      videoId?: string;
      context?: { client?: { clientName?: string; clientVersion?: string } };
    };
    expect(body.videoId).toBe('aqz-KE-bpKQ');
    expect(body.context?.client?.clientName).toBe('ANDROID');
    expect(body.context?.client?.clientVersion).toBe('20.10.38');
  });

  it('uses a declared size when the payload has one', async () => {
    const { fetchText } = playerFetch({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Sized' },
      streamingData: {
        formats: [
          {
            itag: 18,
            url: 'https://rr2---sn-x.googlevideo.com/videoplayback?itag=18',
            qualityLabel: '720p',
            contentLength: '28523658',
          },
        ],
      },
    });
    const resolved = await resolvePageUrl(WATCH, fetchText);
    expect(resolved.formats[0]!.size).toBe(28523658);
  });

  it('reports a video-only progressive entry honestly instead of claiming sound', async () => {
    const { fetchText } = playerFetch({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Silent' },
      streamingData: {
        formats: [
          { itag: 18, url: 'https://rr2---sn-x.googlevideo.com/videoplayback?itag=18', qualityLabel: '360p', mimeType: 'video/mp4' },
        ],
      },
    });
    const resolved = await resolvePageUrl(WATCH, fetchText);
    expect(resolved.formats[0]!.hasAudio).toBe(false);
  });

  it('never lists an adaptive track, because the CDN serves only its first minute', async () => {
    const { fetchText } = playerFetch(playerResponse);
    const resolved = await resolvePageUrl(WATCH, fetchText);

    // 720p60 + audio are right there in the payload and would look like a
    // better download. They are capped at ~12 MiB / ~1 MiB of each track, so
    // offering them would produce a one-minute file that appears complete.
    expect(resolved.formats.some((format) => format.url.includes('itag=298'))).toBe(false);
    expect(resolved.formats.some((format) => format.container === 'dash-mux')).toBe(false);
    expect(resolved.formats.some((format) => format.container === 'dash-audio')).toBe(false);
  });

  it('accepts every watch-page URL shape', async () => {
    for (const url of [
      'https://youtu.be/aqz-KE-bpKQ',
      'https://www.youtube.com/shorts/aqz-KE-bpKQ',
      'https://m.youtube.com/watch?v=aqz-KE-bpKQ&feature=share',
      'https://www.youtube.com/embed/aqz-KE-bpKQ',
    ]) {
      const { calls, fetchText } = playerFetch(playerResponse);
      const resolved = await resolvePageUrl(url, fetchText);
      expect(resolved.formats).toHaveLength(1);
      expect(JSON.parse(calls[0]!.options!.body!).videoId).toBe('aqz-KE-bpKQ');
    }
  });

  it('says WHY playback was refused instead of reporting an empty page', async () => {
    const { fetchText } = playerFetch({
      playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" },
      videoDetails: { title: 'Members-only stream' },
    });
    const resolved = await resolvePageUrl(WATCH, fetchText);

    expect(resolved.formats).toHaveLength(0);
    // "No formats found" is not an answer the user can act on. The reason
    // survives the fall-through to the generic scan, and YouTube's own words
    // come with it — that is the line that makes a report checkable.
    expect(resolved.failure).toEqual({
      reason: 'login',
      host: 'www.youtube.com',
      detail: "Sign in to confirm you're not a bot",
    });
    // And the card still names the video the user asked for: the refusal page
    // YouTube serves instead is titled `- YouTube`, which is no title at all.
    expect(resolved.title).toBe('Members-only stream');
  });

  it('falls through to the generic scan, and still reports why', async () => {
    const { fetchText } = playerFetch(null, 'reject');
    const resolved = await resolvePageUrl(WATCH, fetchText);
    // A blocked endpoint (a proxy-less server, a network wall) must not be
    // reported as "this video has no downloadable formats" — the status is
    // what separates a refusal from a transport failure.
    expect(resolved.formats).toHaveLength(0);
    expect(resolved.failure).toMatchObject({ reason: 'blocked', host: 'www.youtube.com', status: 403 });
  });

  it('does not claim a lookalike host', async () => {
    const { calls, fetchText } = playerFetch(playerResponse);
    await resolvePageUrl('https://youtube.com.evil.example/watch?v=aqz-KE-bpKQ', fetchText);
    expect(calls.filter((call) => call.url.includes('youtubei'))).toHaveLength(0);
  });
});

describe('SUPPORTED_PLATFORMS', () => {
  it('lists every adapter the resolver actually dispatches to', () => {
    expect(SUPPORTED_PLATFORMS.map((platform) => platform.id)).toEqual([
      'bilibili-pgc',
      'acfun',
      'youtube',
      'bilibili',
      'douyin',
    ]);
    for (const platform of SUPPORTED_PLATFORMS) {
      expect(platform.label.length).toBeGreaterThan(0);
      expect(platform.example).toMatch(/^https?:/);
    }
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
