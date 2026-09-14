/**
 * HLS download pipeline — segments in, one playable file out.
 *
 * Runs in an extension page context (the dashboard), which is CORS-exempt
 * via the extension's `<all_urls>` host permission, so segment fetches that
 * a normal page could not make work here. The web build uses the same code;
 * most CDNs send permissive CORS for media, and hosts that do not produce
 * a clear fetch error instead of a silent failure.
 *
 * Pipeline per download:
 *   1. resolve master → variant media playlist (best bandwidth by default)
 *   2. fetch the key once (AES-128) — keys are short-lived, same session
 *   3. pool-download init + segments (retries, per-segment validation)
 *   4. decrypt AES-128-CBC via WebCrypto (IV from playlist or sequence no.)
 *   5. stream everything IN ORDER to disk via File System Access API —
 *      no multi-GB Blob in memory; falls back to in-memory blobs when the
 *      API is unavailable (older browsers / some web contexts)
 *
 * SAMPLE-AES / DRM is refused with an explicit error — never a mangled file.
 *
 * Resume: a failed or canceled attempt RETAINS its sink (see `resumeStore`)
 * rather than aborting it, so a retry appends at the exact byte offset it
 * stopped at instead of starting over. A direct file resumes with a `Range`
 * request; HLS resumes by skipping the segments already written. DASH muxing
 * cannot resume — its output interleaves two tracks by timestamp, so finishing
 * a partial would mean re-fetching both tracks to rebuild the merged header,
 * saving nothing — and it discards its partial to say so.
 */

import { parseMasterPlaylist, parseMediaPlaylist, isMasterPlaylist } from './m3u8';
import { ResumeStore } from './resumeStore';
import {
  BoxStreamParser,
  FragmentMerger,
  buildMergedHeader,
  moovTimescale,
  patchFragment,
  sidxFragmentCount,
  type DashTrackSlot,
  type Mp4Box,
} from './dashMux';
import type { HlsKey, MediaAsset, MediaTask, ParsedMediaPlaylist } from './mediaTypes';
import { createMediaTask } from './mediaTypes';

export interface DownloadCallbacks {
  onTask?: (task: MediaTask) => void;
  onDone?: (task: MediaTask) => void;
  onError?: (task: MediaTask) => void;
}

export interface DownloadOptions {
  /** Chosen variant playlist (defaults to the highest-bandwidth one). */
  variantUrl?: string;
  /** Parallel segment fetches (default 6). */
  concurrency?: number;
  /** Base filename without extension (defaults from the asset). */
  fileName?: string;
  /** Alternate CDN mirrors tried in order when the primary URL fails. */
  backupUrls?: string[];
  /** DASH companion track (audio) — presence selects the muxing pipeline. */
  companionUrl?: string;
  /** Alternate mirrors for the companion track. */
  companionBackupUrls?: string[];
}

export interface DownloadHandle {
  task: MediaTask;
  promise: Promise<MediaTask>;
  cancel: () => void;
}

const SEGMENT_RETRIES = 2;
const DEFAULT_CONCURRENCY = 6;

/** Every media fetch goes out with NO Referer. A browser would otherwise
 *  stamp the dashboard's own origin on each cross-origin request, and the
 *  CDNs read that as hotlinking and refuse: verified against Bilibili, where
 *  the *same* cover URL answers `200` with `Access-Control-Allow-Origin: *`
 *  when the Referer is absent and `403` when it is the page's. Where a site
 *  genuinely requires a Referer (Bilibili's DASH video track), it is added
 *  beyond the browser — by the same-origin proxy, or by the extension's
 *  declarativeNetRequest rule — so this option never works against us. */
const MEDIA_FETCH: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer' };

/** Non-2xx from every mirror. Carries the status so a caller can tell a stale
 *  range (416) or a rotated link (403) apart from a real outage. */
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/* ------------------------------------------------------------------ */
/* Resume state                                                        */
/* ------------------------------------------------------------------ */

/**
 * A sink plus the bookkeeping resume needs.
 *
 * Every byte a pipeline writes goes through here, so the offset and the
 * pipeline cursor are always current. (The alternative — each pipeline
 * keeping its own counters and the partial record being stitched together at
 * failure time — is where "resumed at the wrong offset" bugs live.)
 */
class SinkLease {
  private written = 0;
  /** Pipeline cursor: media segments committed (init segment included). */
  unitsDone = 0;
  signature = '';
  /** Called when the sink is rewound because the source changed. */
  onRewind: (() => void) | null = null;

  constructor(readonly sink: FSWritable) {}

  /** Bytes already accepted by the sink — where a resume appends. */
  get bytesWritten(): number {
    return this.written;
  }

  async write(chunk: Uint8Array): Promise<void> {
    await this.sink.write(chunk);
    this.written += chunk.byteLength;
  }

  /** Rewind to zero, keeping the sink usable (a changed source, or a server
   *  that ignored the range) — a restart, not a discard. */
  async reset(): Promise<void> {
    await this.sink.reset();
    this.written = 0;
    this.unitsDone = 0;
    this.onRewind?.();
  }

  /**
   * Declare which source the partial belongs to. Returns false when the bytes
   * on hand came from a different one — the sink has then been rewound and the
   * caller must start from unit zero. Appending a rotated token's stream to an
   * earlier token's bytes would silently splice two different files together,
   * which is worse than re-downloading.
   */
  async ensureSignature(signature: string): Promise<boolean> {
    if (this.written === 0 || this.signature === signature) {
      this.signature = signature;
      return true;
    }
    await this.reset();
    this.signature = signature;
    return false;
  }

  /** Seed the counters from a retained partial. */
  adopt(bytesWritten: number, unitsDone: number, signature: string): void {
    this.written = bytesWritten;
    this.unitsDone = unitsDone;
    this.signature = signature;
  }

  async close(): Promise<void> {
    await this.sink.close();
  }

  /** Throw the partial away and release the sink (its lock, its memory). */
  async discard(): Promise<void> {
    await this.sink.abort().catch(() => undefined);
  }
}

/** Partials held for a retry. Module scope on purpose: the queue re-invokes
 *  `startDownload` for a retry, and that second call must find the first
 *  one's bytes. */
const resumePartials = new ResumeStore<SinkLease>();

/**
 * Abandon every retained partial — the dock was cleared, or the user is done.
 * Safe by construction: only IDLE partials are ever stored (a live download's
 * lease is held by its own attempt until it settles).
 */
export function discardIdleResumes(): number {
  const held = resumePartials.drain();
  for (const record of held) void record.payload.discard();
  return held.length;
}

/** How many resumable partials are held (diagnostics/tests). */
export function retainedResumeCount(): number {
  return resumePartials.size;
}

/**
 * Whether a failed attempt's partial may be kept for a retry.
 *
 * DASH muxing cannot: its output interleaves two tracks by global timestamp and
 * its merged `moov` header is rebuilt from both track streams, so finishing a
 * partial would re-download nearly everything anyway. A retry there is a clean
 * restart, and the partial is discarded rather than held.
 */
export function isResumable(options: DownloadOptions): boolean {
  return !options.companionUrl;
}

/** Identity of a download, independent of the attempt: same asset, same target
 *  file, same pipeline inputs ⇒ the same partial can be picked up. */
function resumeKeyFor(asset: MediaAsset, fileName: string, options: DownloadOptions): string {
  return [asset.id, fileName, options.variantUrl ?? '', options.companionUrl ?? ''].join('|');
}

/** Total size of the WHOLE file: `Content-Range` when present, else
 *  `Content-Length`. On a 206 the length is only the remainder, so using it
 *  would report a total smaller than the bytes already on disk. */
function responseTotalBytes(response: Response): number | null {
  const range = response.headers.get('content-range');
  const fromRange = range ? Number(range.split('/')[1]) : NaN;
  if (Number.isFinite(fromRange) && fromRange > 0) return fromRange;
  const declared = Number(response.headers.get('content-length'));
  return Number.isFinite(declared) && declared > 0 ? declared : null;
}

/** true when the platform can stream straight to disk. */
export function canStreamToDisk(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

interface FSDirectoryHandle {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<FSStreamLike> }>;
}

/** A folder the user granted once. While it is set every download writes
 *  straight into it with no dialog — which is the only way a QUEUED job can
 *  write at all: `showSaveFilePicker` needs transient user activation, and a
 *  job the queue starts ten seconds later no longer has it. */
let downloadDirectory: FSDirectoryHandle | null = null;

/** The folder downloads currently land in, or null when each one asks. */
export function downloadDirectoryName(): string | null {
  return downloadDirectory?.name ?? null;
}

/** Forget the granted folder (permission revoked, or the user cleared it). */
export function forgetDownloadDirectory(): void {
  downloadDirectory = null;
}

/** Ask for a download folder. Must be called inside a click — it is the one
 *  moment the browser will show the picker. Throws `AbortError` if the user
 *  dismisses it. */
export async function pickDownloadDirectory(): Promise<string | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (options?: { mode?: string }) => Promise<FSDirectoryHandle> })
    .showDirectoryPicker;
  if (typeof picker !== 'function') return null;
  const handle = await picker({ mode: 'readwrite' });
  downloadDirectory = handle;
  return handle.name;
}

/**
 * Start a download for an asset. The save dialog opens synchronously from
 * the click handler so the browser's user-activation window is respected.
 *
 * A previous failed or canceled attempt at the same download is picked up
 * here: its retained sink is reused and its byte offset seeded, which is what
 * makes a retry a resume rather than a restart.
 */
export function startDownload(asset: MediaAsset, options: DownloadOptions = {}, callbacks: DownloadCallbacks = {}): DownloadHandle {
  const fileName = options.fileName ?? asset.fileName;
  const task = createMediaTask(asset.id, asset.fileName, fileName);
  const controller = new AbortController();
  const key = resumeKeyFor(asset, fileName, options);
  /** DASH muxing cannot resume (see the module header), so its failures drop
   *  the partial instead of holding it. */
  const resumable = isResumable(options);
  let lease: SinkLease | null = null;

  const update = () => callbacks.onTask?.({ ...task });

  const openWriter = async (suggestedName: string): Promise<FSWritable> => {
    // A granted folder wins: no per-file dialog, which is what lets a queued
    // batch write several files in a row.
    if (downloadDirectory) {
      try {
        const fileHandle = await downloadDirectory.getFileHandle(suggestedName, { create: true });
        return fsSink(await fileHandle.createWritable());
      } catch {
        // Permission was revoked since it was granted — fall back below.
        downloadDirectory = null;
      }
    }
    if (canStreamToDisk()) {
      try {
        const picker = (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<unknown> }).showSaveFilePicker;
        const handle = (await picker({
          suggestedName,
          types: filePickerTypes(suggestedName),
        })) as { createWritable(): Promise<FSStreamLike> };
        return fsSink(await handle.createWritable());
      } catch (err) {
        // The user canceling the picker is a real cancel; everything else
        // (embedded contexts without user activation, permission denials)
        // falls back to the memory sink rather than dying silently.
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
      }
    }
    return new MemoryWritable(suggestedName);
  };

  /** Reuse the retained partial when there is one; otherwise open a sink. */
  const acquire = async (): Promise<SinkLease> => {
    const held = resumePartials.drop(key);
    if (held) {
      if (resumable) {
        // Hand the bytes on; the pipeline re-declares its source signature and
        // rewinds the sink itself if it turns out to be a different stream.
        const reused = held.payload;
        reused.adopt(held.bytesWritten, held.unitsDone, held.signature);
        return reused;
      }
      // A partial that can never be appended to — release its lock/memory.
      void held.payload.discard();
    }
    return new SinkLease(await openWriter(fileName));
  };

  const promise = (async (): Promise<MediaTask> => {
    try {
      task.state = 'preparing';
      update();

      // Probe the source BEFORE the save dialog so a dead/DRM/live stream
      // fails with a message instead of a wasted file dialog — and the
      // picker (which needs user activation) still opens in the same task,
      // which keeps the activation alive in practice for real clicks.
      await probeAsset(asset, options, controller.signal);

      const sink = await acquire();
      sink.onRewind = () => {
        // The bytes turned out to belong to a different source; stop claiming
        // to have resumed anything.
        task.resumedFromBytes = undefined;
        task.receivedBytes = 0;
        task.progress = 0;
      };
      lease = sink;
      if (sink.bytesWritten > 0) {
        // Report the resumed position up front so the bar starts where the last
        // attempt stopped rather than at zero.
        task.receivedBytes = sink.bytesWritten;
        task.resumedFromBytes = sink.bytesWritten;
      }

      if (options.companionUrl) {
        await downloadDashMux(asset, task, sink, options, controller.signal, update);
      } else if (asset.container === 'hls') {
        await downloadHls(asset, task, sink, options, controller.signal, update);
      } else {
        await downloadFile(asset, task, sink, controller.signal, update, options.backupUrls);
      }

      await sink.close();
      resumePartials.drop(key);
      task.state = 'done';
      task.progress = 1;
      task.finishedAt = Date.now();
      update();
      callbacks.onDone?.({ ...task });
    } catch (err) {
      // User canceling the save dialog is not an error worth surfacing.
      const aborted = controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
      task.state = aborted ? 'canceled' : 'error';
      task.error = aborted ? undefined : err instanceof Error ? err.message : String(err);
      task.finishedAt = Date.now();
      // Keep what was written so a retry continues from here — nothing is
      // visible on disk while a partial is held (`resumeStore` explains why),
      // so this cannot leave a truncated file behind. Anything else (nothing
      // written, or a pipeline that cannot resume) releases the sink instead.
      if (lease && resumable && lease.bytesWritten > 0) {
        for (const evicted of resumePartials.put(key, {
          bytesWritten: lease.bytesWritten,
          unitsDone: lease.unitsDone,
          signature: lease.signature,
          payload: lease,
          updatedAt: Date.now(),
        })) {
          void evicted.payload.discard();
        }
      } else {
        void lease?.discard();
      }
      update();
      if (!aborted) callbacks.onError?.({ ...task });
    }
    return { ...task };
  })();

  return {
    task,
    promise,
    cancel: () => controller.abort(),
  };
}

/* ------------------------------------------------------------------ */
/* Direct file download (mp4/mp3/…) with byte progress                 */
/* ------------------------------------------------------------------ */

async function downloadFile(asset: MediaAsset, task: MediaTask, lease: SinkLease, signal: AbortSignal, update: () => void, backupUrls: string[] = []): Promise<void> {
  const urls = [asset.url, ...backupUrls];
  await lease.ensureSignature(`file:${urls.join('|')}`);
  const resumeAt = lease.bytesWritten;

  let response: Response;
  try {
    response = await fetchWithBackups(urls, signal, resumeAt > 0 ? { Range: `bytes=${resumeAt}-` } : undefined);
  } catch (err) {
    // A refused range (416 for a partial the CDN no longer has, 403 for a
    // rotated link) means the bytes on hand do not match what the server will
    // serve now. Rewind and take the whole file rather than failing forever on
    // a range the server will never honour.
    if (resumeAt > 0 && err instanceof HttpError) {
      await lease.reset();
      response = await fetchWithBackups(urls, signal);
    } else {
      throw err;
    }
  }

  // `200` despite asking for a range: this body is the file from byte zero, so
  // keeping the old bytes would splice a duplicate prefix into the output.
  if (lease.bytesWritten > 0 && response.status !== 206) await lease.reset();

  if (!response.body) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  if (/text\/html/i.test(type)) throw new Error('Server returned a web page instead of the media file (link may be expired)');

  task.totalBytes = responseTotalBytes(response);
  task.receivedBytes = lease.bytesWritten;
  if (task.totalBytes) task.progress = Math.min(1, task.receivedBytes / task.totalBytes);
  update();

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await lease.write(value);
    task.receivedBytes = lease.bytesWritten;
    if (task.totalBytes) task.progress = Math.min(1, task.receivedBytes / task.totalBytes);
    update();
  }
  task.totalBytes = task.totalBytes ?? task.receivedBytes;
}

/* ------------------------------------------------------------------ */
/* Pre-flight probe — validate before the save dialog                  */
/* ------------------------------------------------------------------ */

/** Cheap validation pass over the asset: playlists must parse and offer
 *  downloadable VOD content; files must answer with a non-HTML response.
 *  Runs before the save dialog opens. Refuses live windows here too —
 *  the downloadHls copy stays as a second line of defense. */
async function probeAsset(asset: MediaAsset, options: DownloadOptions, signal: AbortSignal): Promise<void> {
  if (asset.container !== 'hls') {
    const response = await fetch(asset.url, { ...MEDIA_FETCH, method: 'HEAD', signal }).catch(() =>
      fetch(asset.url, { ...MEDIA_FETCH, method: 'GET', headers: { Range: 'bytes=0-1' }, signal }),
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (/text\/html/i.test(type)) throw new Error('Server returned a web page instead of the media file (link may be expired)');
    return;
  }
  const playlistUrl = options.variantUrl ?? asset.playlistUrl ?? asset.url;
  let playlist = await fetchPlaylist(playlistUrl, signal);
  if (isMasterPlaylist(playlist.body)) {
    const master = parseMasterPlaylist(playlist.body, playlistUrl);
    const best = [...master.variants].sort((a, b) => b.bandwidth - a.bandwidth)[0];
    if (!best) throw new Error('Master playlist has no variants');
    playlist = await fetchPlaylist(best.url, signal);
  }
  const media = parseMediaPlaylist(playlist.body, playlist.url);
  if (media.segments.length === 0) throw new Error('Playlist contains no segments');
  if (media.isLive) throw new Error('Live stream — only finished (VOD) streams can be downloaded');
  if (media.key && media.key.method !== 'AES-128') {
    throw new Error(`${media.key.method} streams are DRM-protected and cannot be downloaded`);
  }
}

/* ------------------------------------------------------------------ */
/* HLS pipeline                                                        */
/* ------------------------------------------------------------------ */

async function downloadHls(
  asset: MediaAsset,
  task: MediaTask,
  lease: SinkLease,
  options: DownloadOptions,
  signal: AbortSignal,
  update: () => void,
): Promise<void> {
  const playlistUrl = options.variantUrl ?? asset.playlistUrl ?? asset.url;
  let playlist = await fetchPlaylist(playlistUrl, signal);

  if (isMasterPlaylist(playlist.body)) {
    const master = parseMasterPlaylist(playlist.body, playlistUrl);
    if (master.variants.length === 0) throw new Error('Master playlist has no variants');
    const best =
      master.variants.find((v) => v.url === playlistUrl) ??
      [...master.variants].sort((a, b) => b.bandwidth - a.bandwidth)[0]!;
    playlist = await fetchPlaylist(best.url, signal);
    task.title = `${task.title} (${best.resolution ?? `${Math.round(best.bandwidth / 1000)}k`})`;
  }

  if (isMasterPlaylist(playlist.body)) throw new Error('Nested master playlists are not supported');

  const media = parseMediaPlaylist(playlist.body, playlist.url);
  if (media.segments.length === 0) throw new Error('Playlist contains no segments');
  if (media.isLive) throw new Error('Live stream — waiting on an unbounded window; only VOD (finished) streams can be downloaded');

  const initSegment = media.initSegment;
  const unitsTotal = media.segments.length + (initSegment ? 1 : 0);
  task.segmentsTotal = unitsTotal;

  // The partial only fits THIS playlist: a rotated token or a re-encoded
  // ladder yields different segment URLs, and appending those to the bytes
  // already written would splice two different streams together. `fresh` comes
  // back false when the signature changed — the sink is already rewound.
  const fresh = await lease.ensureSignature(
    `hls:${initSegment ?? ''}:${media.segments.length}:${media.segments[0]}:${media.segments[media.segments.length - 1]}`,
  );
  // Init segment counts as the first unit, so skipping `unitsDone` units means
  // skipping the init plus the segments already on disk.
  const unitsWritten = fresh ? Math.min(lease.unitsDone, unitsTotal) : 0;
  const alreadyWritten = Math.max(0, unitsWritten - (initSegment ? 1 : 0));
  if (unitsWritten > 0) {
    task.receivedBytes = lease.bytesWritten;
    task.segmentsDone = unitsWritten;
    task.progress = unitsWritten / Math.max(1, unitsTotal);
    update();
  }

  if (media.key && media.key.method !== 'AES-128') {
    throw new Error(`${media.key.method} streams are DRM-protected and cannot be downloaded`);
  }
  const cryptoKey = media.key ? await fetchKey(media.key, signal) : null;

  // Download the pool, merge strictly in order. Only the segments that are not
  // already written are claimed, so a resume refetches nothing it already has.
  const chunks = new Array<Uint8Array | null>(media.segments.length).fill(null);
  let nextToWrite = alreadyWritten;

  /**
   * Flush every segment that is now contiguous.
   *
   * Serialised through a promise chain, and this is load-bearing: workers call
   * it concurrently, and the loop yields inside `await lease.write()`. Two
   * workers that entered together would both read the SAME slot, write the same
   * segment twice and each bump the cursor — silently skipping a segment and
   * producing a file that is missing a chunk with nothing to show for it. The
   * chain also keeps the cursor monotonic, which is what a resume offset is.
   */
  let writeChain: Promise<void> = Promise.resolve();
  const writeReady = (): Promise<void> => {
    writeChain = writeChain.then(async () => {
      while (nextToWrite < chunks.length && chunks[nextToWrite]) {
        const chunk = chunks[nextToWrite]!;
        await lease.write(chunk);
        chunks[nextToWrite] = null;
        nextToWrite++;
      }
      lease.unitsDone = (initSegment ? 1 : 0) + nextToWrite;
      task.receivedBytes = lease.bytesWritten;
      // Counted in the same units as `segmentsTotal` (which includes the init
      // segment) so the dock does not read "2/4" and then jump to "4/4".
      task.segmentsDone = lease.unitsDone;
      task.progress = Math.min(1, ((initSegment ? 1 : 0) + nextToWrite) / Math.max(1, unitsTotal));
      update();
    });
    return writeChain;
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextClaim();
      if (index === null) return;
      let data = await fetchSegment(media.segments[index]!, signal);
      if (cryptoKey) data = await decryptSegment(data, cryptoKey, media, index);
      chunks[index] = data;
      await writeReady();
    }
  };

  let cursor = alreadyWritten;
  const nextClaim = (): number | null => (cursor < media.segments.length ? cursor++ : null);

  // The init segment (fMP4/CMAF header) must precede every segment, so it is
  // written once — on a resume that already includes it, it is not refetched.
  if (initSegment && unitsWritten === 0) {
    const init = await fetchSegment(initSegment, signal);
    await lease.write(init);
    lease.unitsDone = 1;
  }

  const remaining = media.segments.length - alreadyWritten;
  const pool = Array.from({ length: Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, remaining) }, () => worker());
  await Promise.all(pool);
  await writeReady();
  task.segmentsDone = task.segmentsTotal;
  task.receivedBytes = lease.bytesWritten;
  task.progress = 1;
  update();
}

/* ------------------------------------------------------------------ */
/* DASH mux pipeline — two tracks in, one complete MP4 out              */
/* ------------------------------------------------------------------ */

interface DashTrackState {
  slot: DashTrackSlot;
  parser: BoxStreamParser;
  headers: Mp4Box[];
  timescale: number;
  pendingMoof: Mp4Box | null;
  bytesReceived: number;
  bytesTotal: number | null;
  done: boolean;
  gatesOpen: boolean;
  fragmentCount: number;
}

/**
 * Download a DASH video+audio pair and stream ONE merged MP4 to disk.
 *
 * Both tracks download concurrently through BoxStreamParsers; complete
 * (moof, mdat) pairs go into a FragmentMerger, which releases them in
 * global time order (tfdt ÷ per-track timescale). Output layout:
 * ftyp + merged moov, then interleaved fragments with tfhd track id and
 * mfhd sequence patched per fragment.
 *
 * Ordering contract: NO fragment is written before the merged header —
 * guaranteed with a start gate (both tracks signal moov-ready before
 * either proceeds), so the drain loop needs no re-entrancy tricks.
 * Memory bound: one pending fragment per track plus the merge buffer.
 */
async function downloadDashMux(
  asset: MediaAsset,
  task: MediaTask,
  lease: SinkLease,
  options: DownloadOptions,
  signal: AbortSignal,
  update: () => void,
): Promise<void> {
  // Deliberately NOT resumable: fragments from the two tracks are interleaved
  // into one file by global timestamp, and the merged `moov` header can only be
  // rebuilt by re-reading both streams from their start. A "resume" would
  // therefore re-download nearly everything anyway — `startDownload` discards
  // this partial and a retry is a clean restart.
  const tracks = new Map<DashTrackSlot, DashTrackState>();
  const merger = new FragmentMerger();
  let sequence = 0;
  let headerWritten = false;
  let fragmentsEmitted = 0;
  let headerWritePromise: Promise<void> = Promise.resolve();

  const estimateReceived = (): number => [...tracks.values()].reduce((sum, t) => sum + t.bytesReceived, 0);
  const estimateTotal = (): number | null => {
    const total = [...tracks.values()].reduce((sum, t) => sum + (t.bytesTotal ?? 0), 0);
    return total > 0 ? total : null;
  };

  const writeFragment = async (ready: { slot: DashTrackSlot; moof: Mp4Box; mdat: Mp4Box }): Promise<void> => {
    sequence += 1;
    const patched = patchFragment(ready.moof, ready.slot === 'video' ? 1 : 2, sequence);
    // ONE write for the (moof, mdat) pair: two awaited writes could be
    // interleaved by the other track's loop (moofA, moofB, mdatA, …),
    // which corrupts the file — mdat must directly follow its moof.
    const pair = new Uint8Array(patched.data.length + ready.mdat.data.length);
    pair.set(patched.data, 0);
    pair.set(ready.mdat.data, patched.data.length);
    await lease.write(pair);
    fragmentsEmitted += 1;
    task.segmentsDone = fragmentsEmitted;
    task.segmentsTotal = Math.max(fragmentsEmitted, [...tracks.values()].reduce((s, t) => s + (t.fragmentCount ?? 0), 0));
    const total = estimateTotal();
    if (total) {
      task.totalBytes = total;
      task.receivedBytes = estimateReceived();
      task.progress = Math.min(0.99, task.receivedBytes / total);
    }
    update();
  };

  const trackProgress = (): void => {
    const total = estimateTotal();
    if (total && !headerWritten) return; // header phase; sizes still settling
    if (total) {
      task.totalBytes = total;
      task.receivedBytes = estimateReceived();
      task.progress = Math.min(0.99, task.receivedBytes / total);
      update();
    }
  };

  const releaseGate = (slot: DashTrackSlot): void => {
    const state = tracks.get(slot);
    if (!state?.gatesOpen) {
      if (state) state.gatesOpen = true;
      if ([...tracks.values()].every((t) => t.gatesOpen)) writeMergedHeader();
    }
  };

  /** Emit ftyp + merged moov once BOTH track headers are known. Initiated
   *  synchronously at gate release — before either reader loop can push a
   *  fragment — and writer.write orders by call time, so the header is
   *  guaranteed to precede every fragment byte in the file. */
  const writeMergedHeader = (): void => {
    if (headerWritten) return;
    const video = tracks.get('video');
    const audio = tracks.get('audio');
    if (!video || !audio) return;
    for (const box of buildMergedHeader(video.headers, audio.headers)) {
      headerWritePromise = headerWritePromise.then(() => lease.write(box.data));
    }
    headerWritten = true;
  };

  const runTrack = async (slot: DashTrackSlot, url: string, backups: string[]): Promise<void> => {
    const state: DashTrackState = {
      slot,
      parser: new BoxStreamParser(),
      headers: [],
      timescale: 0,
      pendingMoof: null,
      bytesReceived: 0,
      bytesTotal: null,
      done: false,
      gatesOpen: false,
      fragmentCount: 0,
    };
    tracks.set(slot, state);

    const response = await fetchWithBackups([url, ...backups], signal);
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (/text\/html/i.test(type)) throw new Error('Server returned a web page instead of the media file (link may be expired)');
    const declared = Number(response.headers.get('content-length'));
    state.bytesTotal = Number.isFinite(declared) && declared > 0 ? declared : null;

    const reader = response.body.getReader();
    let moovReady = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw new Error('aborted');
      state.bytesReceived += value.byteLength;

      for (const box of state.parser.push(value)) {
        if (!moovReady) {
          state.headers.push(box);
          if (box.type === 'moov') {
            state.timescale = moovTimescale(box);
            moovReady = true;
            state.bytesTotal = state.bytesTotal ?? state.bytesReceived;
            releaseGate(slot);
          }
          continue;
        }
        if (box.type === 'sidx') {
          const count = sidxFragmentCount(box);
          if (count) state.fragmentCount = count;
        } else if (box.type === 'moof') {
          state.pendingMoof = box;
        } else if (box.type === 'mdat') {
          const moof = state.pendingMoof;
          state.pendingMoof = null;
          if (!moof) throw new Error('dash-mux: mdat without moof');
          for (const ready of merger.push(slot, moof, box, state.timescale || 1)) {
            await writeFragment(ready);
          }
        }
        // 'free'/'skip'/unknown post-header boxes: skipped.
      }
      trackProgress();
    }
    state.done = true;
    if (state.pendingMoof) throw new Error('dash-mux: stream ended mid-fragment');
    if (!moovReady) throw new Error('dash-mux: no moov in track stream');
    releaseGate(slot);
    for (const ready of merger.flush()) await writeFragment(ready);
  };

  await Promise.all([
    runTrack('video', asset.url, options.backupUrls ?? []),
    runTrack('audio', options.companionUrl!, options.companionBackupUrls ?? []),
  ]);

  if (!headerWritten) throw new Error('dash-mux: failed to build merged header');
  await headerWritePromise; // surface header write failures (disk full…)
  if (fragmentsEmitted === 0) throw new Error('dash-mux: no fragments downloaded');
  task.segmentsTotal = fragmentsEmitted;
  task.segmentsDone = fragmentsEmitted;
  task.totalBytes = estimateReceived();
  task.receivedBytes = task.totalBytes;
  task.progress = 1;
  update();
}

/** Try each URL in order; first success wins. Protected CDNs (Bilibili's
 *  upos mirrors) rotate hosts — a 403 on the primary mirror is routine. */
async function fetchWithBackups(urls: string[], signal: AbortSignal, headers?: Record<string, string>): Promise<Response> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { ...MEDIA_FETCH, headers, signal });
      if (response.ok) return response;
      lastError = new HttpError(response.status);
    } catch (err) {
      if (signal.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All download sources failed');
}

async function fetchPlaylist(url: string, signal: AbortSignal): Promise<{ url: string; body: string }> {
  const response = await fetch(url, { ...MEDIA_FETCH, signal });
  if (!response.ok) throw new Error(`Playlist HTTP ${response.status}`);
  const body = await response.text();
  if (!body.includes('#EXTM3U')) throw new Error('Not a valid m3u8 playlist');
  return { url, body };
}

async function fetchKey(key: HlsKey, signal: AbortSignal): Promise<CryptoKey> {
  if (!key.uri) throw new Error('Encryption key URI missing');
  const response = await fetch(key.uri, { ...MEDIA_FETCH, signal });
  if (!response.ok) throw new Error(`Key fetch HTTP ${response.status} — the session that played this stream may be required`);
  const raw = await response.arrayBuffer();
  if (raw.byteLength !== 16) throw new Error(`Unexpected key size (${raw.byteLength} bytes)`);
  return crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt']);
}

async function fetchSegment(url: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= SEGMENT_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { ...MEDIA_FETCH, signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get('content-type') ?? '';
      if (/text\/html/i.test(type)) throw new Error('segment returned HTML (token expired?)');
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (err) {
      if (signal.aborted) throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw new Error(`Segment fetch failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** AES-128-CBC. Default IV (RFC 8216 §4.3.2.4) is the media sequence number. */
async function decryptSegment(data: Uint8Array<ArrayBuffer>, cryptoKey: CryptoKey, media: ParsedMediaPlaylist, index: number): Promise<Uint8Array<ArrayBuffer>> {
  const iv = media.key?.iv ? hexToBytes(media.key.iv) : sequenceToIv(media.mediaSequence + index);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, data);
    return new Uint8Array(plain);
  } catch {
    throw new Error(`Segment ${index} failed to decrypt — the stream may use non-standard padding`);
  }
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.replace(/^0x/i, '').padStart(32, '0').slice(-32);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function sequenceToIv(sequence: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(16);
  const view = new DataView(iv.buffer);
  view.setUint32(12, sequence >>> 0);
  return iv;
}

/* ------------------------------------------------------------------ */
/* Filesystem sinks                                                    */
/* ------------------------------------------------------------------ */

interface FSWritable {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Throw the data away and release the sink. */
  abort(): Promise<void>;
  /** Rewind to zero, KEEPING the sink usable — a restart, not a discard. Used
   *  when a retained partial turns out to belong to a different source. */
  reset(): Promise<void>;
}

/** The slice of `FileSystemWritableFileStream` we rely on. Only the standard
 *  navigator-storage shape, no DOM lib dependency. */
interface FSStreamLike {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
  truncate?: (size: number) => Promise<void>;
  seek?: (position: number) => Promise<void>;
}

/**
 * Adapt a File System Access writable to the sink contract.
 *
 * `reset()` maps onto the API's own `truncate`/`seek`, which is exactly the
 * operation resume needs when a partial is invalidated. If they are missing
 * (an old or partial implementation) it THROWS rather than silently doing
 * nothing — appending fresh bytes to stale ones would produce a file that
 * looks complete and is not.
 */
function fsSink(stream: FSStreamLike): FSWritable {
  const truncate = stream.truncate?.bind(stream);
  const seek = stream.seek?.bind(stream);
  return {
    write: (chunk) => stream.write(chunk),
    close: () => stream.close(),
    abort: () => stream.abort(),
    reset: async () => {
      if (!truncate || !seek) throw new Error('This browser cannot rewind a partial download');
      await truncate(0);
      await seek(0);
    },
  };
}

/** Save-dialog filter for a file name. The dialog used to offer `.ts`/`.mp4`
 *  only, so an audio track (`.m4a`) or the cover (`.jpg`) had nothing to
 *  match and Chrome could not name the file. */
const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  ts: 'video/mp2t',
  mp3: 'audio/mpeg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function filePickerTypes(suggestedName: string): { description: string; accept: Record<string, string[]> }[] {
  const extension = suggestedName.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) return [];
  return [{ description: 'Media', accept: { [mime]: [`.${extension}`] } }];
}

/** Fallback sink: buffers in memory, then hands the blob to the browser's
 *  download mechanism (chrome.downloads in the extension, anchor on web).
 *  Multi-GB downloads should use the disk sink — this is the safety net. */
class MemoryWritable implements FSWritable {
  private parts: Uint8Array[] = [];

  constructor(private readonly fileName: string) {}

  async write(chunk: Uint8Array): Promise<void> {
    this.parts.push(chunk);
  }

  async close(): Promise<void> {
    const blob = new Blob(this.parts as BlobPart[]);
    this.parts = [];
    const url = URL.createObjectURL(blob);
    try {
      if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
        await chrome.downloads.download({ url, filename: this.fileName, saveAs: true });
      } else {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = this.fileName;
        anchor.click();
      }
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  async abort(): Promise<void> {
    this.parts = [];
  }

  async reset(): Promise<void> {
    this.parts = [];
  }
}
