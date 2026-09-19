import { describe, expect, it } from 'vitest';
import { normalizeYtdlpInfo } from './ytdlp-executor.mjs';

const pageUrl = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

describe('yt-dlp result normalization', () => {
  it('maps muxed and video-only formats into the dashboard format ladder', () => {
    const asset = normalizeYtdlpInfo({
      id: 'aqz-KE-bpKQ',
      title: ' Big Buck Bunny ',
      thumbnail: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/maxres.jpg',
      duration: 634.5,
      formats: [
        { format_id: '18', url: 'https://cdn/video-360.mp4', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360, filesize: 10_000_000 },
        { format_id: '137', url: 'https://cdn/video-1080.mp4', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080, filesize: 90_000_000 },
        { format_id: '140', url: 'https://cdn/audio.m4a', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', abr: 128, filesize: 4_000_000 },
        { format_id: 'storyboard', url: 'https://cdn/sb', ext: 'mhtml', vcodec: 'none', acodec: 'none' },
      ],
    }, pageUrl);

    expect(asset.title).toBe('Big Buck Bunny');
    expect(asset.cover).toBe('https://i.ytimg.com/vi/aqz-KE-bpKQ/maxres.jpg');
    expect(asset.pageUrl).toBe(pageUrl);
    expect(asset.dashOnly).toBe(false);
    expect(asset.notice).toBe('');

    // Complete files (own audio) lead the ladder, best quality first.
    const complete = asset.formats.filter((f) => f.hasAudio);
    expect(complete.map((f) => f.quality)).toEqual(['360p']);
    expect(complete[0].key).toBe('ytdlp-18');

    // The video-only 1080p row is paired with the best audio track so the
    // dashboard's existing mux step can merge it without changes.
    const muxPair = asset.formats.find((f) => f.quality === '1080p');
    expect(muxPair.hasAudio).toBe(false);
    expect(muxPair.companionUrl).toBe('https://cdn/audio.m4a');
    expect(muxPair.size).toBe(90_000_000 + 4_000_000);

    // Storyboards and manifest-less entries never reach the ladder.
    expect(asset.formats.every((f) => f.url)).toBe(true);
  });

  it('reports dash-only and empty states honestly', () => {
    const dashOnly = normalizeYtdlpInfo({
      id: 'x', title: 'no audio file', formats: [
        { format_id: 'v', url: 'https://cdn/v.mp4', vcodec: 'avc1', acodec: 'none', height: 720 },
      ],
    }, pageUrl);
    expect(dashOnly.dashOnly).toBe(true);
    expect(dashOnly.notice).toBe('dash-only');

    const empty = normalizeYtdlpInfo({ id: 'x', title: 'empty', formats: [] }, pageUrl);
    expect(empty.formats).toHaveLength(0);
    expect(empty.notice).toBe('empty');
  });
});
