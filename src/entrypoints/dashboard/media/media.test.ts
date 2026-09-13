import { describe, expect, it } from 'vitest';
import { assetIdFor, classifyRequest, fileNameFromUrl } from './mediaClassify';
import { isMasterPlaylist, parseAttributes, parseMasterPlaylist, parseMediaPlaylist, resolveUrl } from './m3u8';

describe('mediaClassify', () => {
  it('classifies HLS playlists and DASH manifests by URL', () => {
    const hls = classifyRequest({ url: 'https://cdn.example.com/video/index.m3u8?token=abc' })!;
    expect(hls.kind).toBe('stream');
    expect(hls.container).toBe('hls');
    expect(hls.encryption).toBe('unknown');

    const dash = classifyRequest({ url: 'https://cdn.example.com/video/manifest.mpd' })!;
    expect(dash.container).toBe('dash');
  });

  it('classifies direct video/audio/subtitle files', () => {
    expect(classifyRequest({ url: 'https://x.com/a.mp4' })!.kind).toBe('video');
    expect(classifyRequest({ url: 'https://x.com/a.ts?sign=1' })!.kind).toBe('video');
    expect(classifyRequest({ url: 'https://x.com/a.m4s' })!.kind).toBe('video');
    expect(classifyRequest({ url: 'https://x.com/a.m4a' })!.kind).toBe('audio');
    expect(classifyRequest({ url: 'https://x.com/a.vtt' })!.kind).toBe('subtitle');
  });

  it('uses content-type when the URL is extensionless', () => {
    const asset = classifyRequest({ url: 'https://cdn.example.com/get-video?id=42', contentType: 'video/mp4' })!;
    expect(asset.kind).toBe('video');
    expect(asset.container).toBe('file');
  });

  it('ignores non-media traffic and pages', () => {
    expect(classifyRequest({ url: 'https://x.com/api/list' })).toBeNull();
    expect(classifyRequest({ url: 'https://x.com/styles.css' })).toBeNull();
    expect(classifyRequest({ url: 'https://x.com/pic.jpg', live: true })).toBeNull();
    // Pasted images (web ingestion) are kept.
    expect(classifyRequest({ url: 'https://x.com/pic.jpg', live: false })!.kind).toBe('image');
    expect(classifyRequest({ url: 'chrome-extension://abc/foo' })).toBeNull();
  });

  it('detects DRM hints in the URL', () => {
    const asset = classifyRequest({ url: 'skd://keyserver.com/content/42' })!;
    expect(asset.encryption).toBe('drm');
  });

  it('derives a usable file name', () => {
    expect(fileNameFromUrl('https://cdn.example.com/v/episode-1.mp4?h=abc', 'video', 'file')).toBe('episode-1.mp4');
    expect(fileNameFromUrl('https://cdn.example.com/get?id=1', 'video', 'file')).toBe('cdn.example.com.mp4');
  });

  it('dedupes cache-busters in the asset id but keeps auth params', () => {
    const a = assetIdFor('https://cdn.example.com/v.mp4?_=%.20&t=123&token=real&x=1');
    const b = assetIdFor('https://cdn.example.com/v.mp4?_=%.30&t=456&token=real&x=1');
    expect(a).toBe(b);
    expect(a).toContain('token=real');
  });
});

describe('m3u8 master playlists', () => {
  const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=640x360,CODECS="avc1.640028,mp4a.40.2"
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4128000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080/index.m3u8`;

  it('detects and parses variants with absolute URLs', () => {
    expect(isMasterPlaylist(master)).toBe(true);
    const parsed = parseMasterPlaylist(master, 'https://cdn.example.com/video/master.m3u8');
    expect(parsed.variants).toHaveLength(2);
    expect(parsed.variants[1]).toMatchObject({
      bandwidth: 4128000,
      resolution: '1920x1080',
      url: 'https://cdn.example.com/video/1080/index.m3u8',
    });
  });
});

describe('m3u8 media playlists', () => {
  const media = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x9c7db8778570d05c3177c349fd9236aa
#EXTINF:9.009,
seg-0.ts
#EXTINF:9.009,
seg-1.ts
#EXT-X-ENDLIST`;

  it('parses segments, key and VOD marker', () => {
    const parsed = parseMediaPlaylist(media, 'https://cdn.example.com/video/1080/index.m3u8');
    expect(parsed.isLive).toBe(false);
    expect(parsed.segments).toEqual([
      'https://cdn.example.com/video/1080/seg-0.ts',
      'https://cdn.example.com/video/1080/seg-1.ts',
    ]);
    expect(parsed.key).toMatchObject({ method: 'AES-128', uri: 'https://cdn.example.com/video/1080/enc.key' });
    expect(parsed.key!.iv).toBe('0x9c7db8778570d05c3177c349fd9236aa');
    expect(parsed.durationSeconds).toBeCloseTo(18.018, 3);
    expect(parsed.targetDuration).toBe(10);
  });

  it('treats playlists without ENDLIST as live', () => {
    const parsed = parseMediaPlaylist('#EXTM3U\n#EXTINF:5,\na.ts', 'https://x.com/v/index.m3u8');
    expect(parsed.isLive).toBe(true);
  });

  it('parses EXT-X-MAP init segments', () => {
    const parsed = parseMediaPlaylist(
      '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\ns1.m4s\n#EXT-X-ENDLIST',
      'https://x.com/v/media.m3u8',
    );
    expect(parsed.initSegment).toBe('https://x.com/v/init.mp4');
  });

  it('keeps commas inside quoted attributes', () => {
    const attrs = parseAttributes('BANDWIDTH=1000,CODECS="avc1,mp4a",URI="a,b.key",IV=0xab');
    expect(attrs.CODECS).toBe('avc1,mp4a');
    expect(attrs.URI).toBe('a,b.key');
    expect(attrs.BANDWIDTH).toBe(1000);
    expect(attrs.IV).toBe('0xab');
  });

  it('resolves relative URIs against the playlist URL', () => {
    expect(resolveUrl('../seg/1.ts', 'https://x.com/a/b/index.m3u8')).toBe('https://x.com/a/seg/1.ts');
  });
});
