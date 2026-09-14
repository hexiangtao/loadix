/**
 * Download-engine resume tests.
 *
 * These drive the REAL `startDownload` pipeline — real playlist parsing, real
 * in-order merging, real byte accounting — against a fake network and the
 * engine's memory sink. (No `window` here, so the sink factory picks memory on
 * its own; that also means a partial lives in the lease, exactly as it would
 * while a disk stream is held open.)
 *
 * What is asserted is the thing that makes resume worth having, and the two
 * ways it can be wrong:
 *   - a retry must NOT re-fetch bytes it already has, and
 *   - the file it produces must be byte-identical to a clean run (no spliced
 *     duplicate prefix when the server ignores the range).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discardIdleResumes, isResumable, retainedResumeCount, startDownload } from './hlsDownload';
import type { MediaAsset } from './mediaTypes';

/* ————————————————— harness ————————————————— */

const encoder = new TextEncoder();
const text = (value: string): Uint8Array<ArrayBuffer> => encoder.encode(value);

/** Every Blob the memory sink builds, captured so output bytes are checkable. */
let blobs: Uint8Array[][] = [];

const concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const bytesResponse = (body: Uint8Array<ArrayBuffer>, init: ResponseInit = {}): Response => new Response(body, init);

const playlistResponse = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });

/** A media playlist with `count` segments, optionally fMP4 (init segment). */
function mediaPlaylist(count: number, initSegment = false): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-MEDIA-SEQUENCE:0',
    ...(initSegment ? ['#EXT-X-MAP:URI="init.mp4"'] : []),
    ...Array.from({ length: count }, (_, index) => `#EXTINF:10,\nseg${index}.ts`),
    '#EXT-X-ENDLIST',
  ].join('\n');
}

const PLAYLIST_URL = 'https://cdn.test/hls/index.m3u8';
const SEGMENT_URL = (index: number): string => `https://cdn.test/hls/seg${index}.ts`;
const INIT_URL = 'https://cdn.test/hls/init.mp4';
const segmentBody = (index: number): Uint8Array<ArrayBuffer> => text(`SEG${index};`);

function makeAsset(overrides: Partial<MediaAsset> & { url: string }): MediaAsset {
  return {
    id: `GET ${overrides.url}`,
    kind: 'video',
    container: 'file',
    contentType: '',
    size: null,
    fileName: 'video.mp4',
    encryption: 'none',
    requestHeaders: [],
    live: false,
    pageUrl: 'https://page.test/',
    firstSeenAt: 0,
    lastSeenAt: 0,
    hits: 1,
    method: 'GET',
    ...overrides,
  };
}

/** The 100-byte file the direct-download tests pull. */
const FULL_FILE = Uint8Array.from({ length: 100 }, (_, index) => index % 251);

/** A body that yields `head` and then dies — a connection reset mid-stream. */
function brokenBody(head: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
  let pulled = false;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (!pulled) {
        pulled = true;
        controller.enqueue(head);
        return;
      }
      controller.error(new Error('network reset'));
    },
  });
}

beforeEach(() => {
  blobs = [];
  const RealBlob = globalThis.Blob;
  class CapturingBlob extends RealBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      blobs.push((parts ?? []) as Uint8Array[]);
    }
  }
  vi.stubGlobal('Blob', CapturingBlob);
  // The memory sink hands its blob to an anchor on the web path.
  vi.stubGlobal('document', { createElement: () => ({ click: () => undefined }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Drop anything a previous test left behind (module state is per-suite). */
function drainPartials(): void {
  discardIdleResumes();
}

/* ————————————————— HLS ————————————————— */

describe('HLS resume', () => {
  it('re-fetches only the segments it does not already have', async () => {
    drainPartials();
    const requested: string[] = [];
    let failing = 3;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        if (url === PLAYLIST_URL) return playlistResponse(mediaPlaylist(5));
        const match = /seg(\d)\.ts$/.exec(url);
        if (match) {
          const index = Number(match[1]);
          if (index === failing) return new Response('boom', { status: 500 });
          return bytesResponse(segmentBody(index));
        }
        throw new Error(`unexpected request ${url}`);
      }),
    );

    const asset = makeAsset({ url: PLAYLIST_URL, container: 'hls', fileName: 'video.ts' });

    const first = await startDownload(asset, { fileName: 'video.ts', concurrency: 3 }).promise;
    expect(first.state).toBe('error');
    expect(retainedResumeCount()).toBe(1);
    // Segments are written strictly in order, so the partial is a clean prefix:
    // 0..2 landed, 3 is the one that failed, 4 has nowhere to go yet.
    expect(first.segmentsDone).toBe(3);

    requested.length = 0;
    failing = -1;
    const second = await startDownload(asset, { fileName: 'video.ts', concurrency: 3 }).promise;

    expect(second.state).toBe('done');
    expect(second.resumedFromBytes).toBeGreaterThan(0);
    expect(second.progress).toBe(1);
    // The whole point: nothing already on disk was fetched again.
    const refetched = [...new Set(requested.filter((url) => /seg\d\.ts$/.test(url)))];
    expect(refetched.sort()).toEqual([SEGMENT_URL(3), SEGMENT_URL(4)]);
    expect(requested.some((url) => /seg[012]\.ts$/.test(url))).toBe(false);

    // …and the result is the complete, correctly ordered file.
    expect(new TextDecoder().decode(concat(blobs.at(-1)!))).toBe('SEG0;SEG1;SEG2;SEG3;SEG4;');
    expect(retainedResumeCount()).toBe(0);
  });

  it('does not refetch an init segment the partial already contains', async () => {
    drainPartials();
    const requested: string[] = [];
    let failing = 2;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        if (url === PLAYLIST_URL) return playlistResponse(mediaPlaylist(3, true));
        if (url === INIT_URL) return bytesResponse(text('INIT;'));
        const match = /seg(\d)\.ts$/.exec(url);
        if (match) {
          const index = Number(match[1]);
          if (index === failing) return new Response('boom', { status: 500 });
          return bytesResponse(segmentBody(index));
        }
        throw new Error(`unexpected request ${url}`);
      }),
    );

    const asset = makeAsset({ url: PLAYLIST_URL, container: 'hls', fileName: 'video.mp4' });

    const first = await startDownload(asset, { fileName: 'video.mp4', concurrency: 3 }).promise;
    expect(first.state).toBe('error');
    // init + seg0 + seg1 are committed; the init counts as a unit, so the
    // partial's cursor is 3 of 4.
    expect(first.segmentsDone).toBe(3);
    expect(first.segmentsTotal).toBe(4);

    requested.length = 0;
    failing = -1;
    const second = await startDownload(asset, { fileName: 'video.mp4', concurrency: 3 }).promise;

    expect(second.state).toBe('done');
    expect(requested).not.toContain(INIT_URL);
    expect(requested.filter((url) => /seg\d\.ts$/.test(url))).toEqual([SEGMENT_URL(2)]);
    expect(new TextDecoder().decode(concat(blobs.at(-1)!))).toBe('INIT;SEG0;SEG1;SEG2;');
  });

  it('restarts cleanly when the playlist changed under the partial', async () => {
    drainPartials();
    // A re-resolved stream: same URL, but the token rotated, so the segment
    // URLs (and therefore the playlist fingerprint) differ.
    let rotated = false;
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        if (url === PLAYLIST_URL) {
          return playlistResponse(rotated ? mediaPlaylist(3).replace(/seg(\d)/g, 'tok$1') : mediaPlaylist(3));
        }
        const match = /(?:seg|tok)(\d)\.ts$/.exec(url);
        if (match) {
          if (Number(match[1]) === 2 && !rotated) return new Response('boom', { status: 500 });
          return bytesResponse(segmentBody(Number(match[1])));
        }
        throw new Error(`unexpected request ${url}`);
      }),
    );

    const asset = makeAsset({ url: PLAYLIST_URL, container: 'hls', fileName: 'video.ts' });
    const first = await startDownload(asset, { fileName: 'video.ts', concurrency: 3 }).promise;
    expect(first.state).toBe('error');

    requested.length = 0;
    rotated = true;
    const second = await startDownload(asset, { fileName: 'video.ts', concurrency: 3 }).promise;

    expect(second.state).toBe('done');
    // A rotated playlist must not be appended to — the stale prefix is dropped
    // and every segment is fetched again, in order, exactly once.
    expect(second.resumedFromBytes).toBeUndefined();
    expect(requested.filter((url) => /tok\d/.test(url)).sort()).toEqual([
      'https://cdn.test/hls/tok0.ts',
      'https://cdn.test/hls/tok1.ts',
      'https://cdn.test/hls/tok2.ts',
    ]);
    expect(new TextDecoder().decode(concat(blobs.at(-1)!))).toBe('SEG0;SEG1;SEG2;');
    expect(retainedResumeCount()).toBe(0);
  });
});

/* ————————————————— direct files ————————————————— */

describe('direct file resume', () => {
  const FILE_URL = 'https://cdn.test/movie.mp4';

  /** Probe (HEAD) + a ranged or plain body, recording the Range it was asked. */
  function fileFetch(options: { supportRange: boolean; ranges: (string | undefined)[] }): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (init?.method === 'HEAD') {
          return new Response(null, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '100' } });
        }
        const range = headers.Range;
        options.ranges.push(range);
        if (range && options.supportRange) {
          const from = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
          return bytesResponse(FULL_FILE.slice(from), {
            status: 206,
            headers: {
              'content-type': 'video/mp4',
              'content-length': String(FULL_FILE.length - from),
              'content-range': `bytes ${from}-${FULL_FILE.length - 1}/${FULL_FILE.length}`,
            },
          });
        }
        return bytesResponse(FULL_FILE, {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': String(FULL_FILE.length) },
        });
      }),
    );
  }

  it('asks for the rest of the file and appends it', async () => {
    drainPartials();
    const asset = makeAsset({ url: FILE_URL, fileName: 'movie.mp4' });

    // First attempt: the server starts sending, then the connection dies.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'HEAD') {
          return new Response(null, { status: 200, headers: { 'content-type': 'video/mp4' } });
        }
        return new Response(brokenBody(FULL_FILE.slice(0, 40)), {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': '100' },
        });
      }),
    );
    const first = await startDownload(asset, { fileName: 'movie.mp4' }).promise;
    expect(first.state).toBe('error');
    expect(first.receivedBytes).toBe(40);
    expect(retainedResumeCount()).toBe(1);

    const ranges: (string | undefined)[] = [];
    fileFetch({ supportRange: true, ranges });
    const second = await startDownload(asset, { fileName: 'movie.mp4' }).promise;

    expect(ranges).toEqual(['bytes=40-']);
    expect(second.state).toBe('done');
    expect(second.resumedFromBytes).toBe(40);
    // Total comes from Content-Range, not the remainder length — otherwise the
    // bar would read 40% on a file that is already 40% on disk.
    expect(second.totalBytes).toBe(100);
    const output = concat(blobs.at(-1)!);
    expect(output.length).toBe(100);
    expect([...output]).toEqual([...FULL_FILE]);
    expect(retainedResumeCount()).toBe(0);
  });

  it('rewinds when the server ignores the range instead of duplicating the prefix', async () => {
    drainPartials();
    const asset = makeAsset({ url: FILE_URL, fileName: 'movie.mp4' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-type': 'video/mp4' } });
        return new Response(brokenBody(FULL_FILE.slice(0, 40)), {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': '100' },
        });
      }),
    );
    expect((await startDownload(asset, { fileName: 'movie.mp4' }).promise).state).toBe('error');

    const ranges: (string | undefined)[] = [];
    fileFetch({ supportRange: false, ranges });
    const second = await startDownload(asset, { fileName: 'movie.mp4' }).promise;

    // Range was asked for and refused with a full 200 — the engine must not
    // keep the 40 stale bytes, or the file would be 140 bytes with its own
    // head spliced in the middle.
    expect(ranges).toEqual(['bytes=40-']);
    expect(second.state).toBe('done');
    expect(second.resumedFromBytes).toBeUndefined();
    const output = concat(blobs.at(-1)!);
    expect(output.length).toBe(100);
    expect([...output]).toEqual([...FULL_FILE]);
  });
});

/* ————————————————— policy ————————————————— */

describe('resume policy', () => {
  it('never resumes a DASH mux (its output interleaves two tracks)', () => {
    expect(isResumable({})).toBe(true);
    expect(isResumable({ companionUrl: 'https://cdn.test/audio.m4a' })).toBe(false);
  });
});
