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
 */

import { parseMasterPlaylist, parseMediaPlaylist, isMasterPlaylist } from './m3u8';
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
}

export interface DownloadHandle {
  task: MediaTask;
  promise: Promise<MediaTask>;
  cancel: () => void;
}

const SEGMENT_RETRIES = 2;
const DEFAULT_CONCURRENCY = 6;

/** true when the platform can stream straight to disk. */
export function canStreamToDisk(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

/**
 * Start a download for an asset. The save dialog opens synchronously from
 * the click handler so the browser's user-activation window is respected.
 */
export function startDownload(asset: MediaAsset, options: DownloadOptions = {}, callbacks: DownloadCallbacks = {}): DownloadHandle {
  const fileName = options.fileName ?? asset.fileName;
  const task = createMediaTask(asset.id, asset.fileName, fileName);
  const controller = new AbortController();
  let writerPromise: Promise<FSWritable> | null = null;

  const update = () => callbacks.onTask?.({ ...task });

  const openWriter = async (suggestedName: string): Promise<FSWritable> => {
    if (canStreamToDisk()) {
      try {
        const picker = (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
        const handle = await picker({
          suggestedName,
          types: [{ description: 'Media', accept: { 'video/mp2t': ['.ts'], 'video/mp4': ['.mp4'], 'application/octet-stream': ['.ts', '.mp4'] } }],
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (handle as any).createWritable() as Promise<FSWritable>;
      } catch (err) {
        // The user canceling the picker is a real cancel; everything else
        // (embedded contexts without user activation, permission denials)
        // falls back to the memory sink rather than dying silently.
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
      }
    }
    return new MemoryWritable(suggestedName);
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

      writerPromise = writerPromise ?? openWriter(fileName);
      const writer = await writerPromise;

      if (asset.container === 'hls') {
        await downloadHls(asset, task, writer, options, controller.signal, update);
      } else {
        await downloadFile(asset, task, writer, controller.signal, update);
      }

      await writer.close();
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
      // Drop the partial file rather than leaving a corrupt one behind.
      void writerPromise
        ?.then((w) => w.abort().catch(() => undefined))
        .catch(() => undefined);
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

async function downloadFile(asset: MediaAsset, task: MediaTask, writer: FSWritable, signal: AbortSignal, update: () => void): Promise<void> {
  const response = await fetch(asset.url, { signal, credentials: 'omit' });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  if (/text\/html/i.test(type)) throw new Error('Server returned a web page instead of the media file (link may be expired)');
  const declared = Number(response.headers.get('content-length'));
  task.totalBytes = Number.isFinite(declared) && declared > 0 ? declared : null;

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await writer.write(value);
    task.receivedBytes += value.byteLength;
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
    const response = await fetch(asset.url, { method: 'HEAD', signal, credentials: 'omit' }).catch(() =>
      fetch(asset.url, { method: 'GET', headers: { Range: 'bytes=0-1' }, signal, credentials: 'omit' }),
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
  writer: FSWritable,
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

  task.segmentsTotal = media.segments.length + (media.initSegment ? 1 : 0);
  update();

  if (media.key && media.key.method !== 'AES-128') {
    throw new Error(`${media.key.method} streams are DRM-protected and cannot be downloaded`);
  }
  const cryptoKey = media.key ? await fetchKey(media.key, signal) : null;

  // Download the pool, merge strictly in order.
  const chunks = new Array<Uint8Array | null>(media.segments.length).fill(null);
  let nextToWrite = 0;
  let decryptedBytes = 0;

  const writeReady = async (): Promise<void> => {
    while (nextToWrite < chunks.length && chunks[nextToWrite]) {
      const chunk = chunks[nextToWrite]!;
      await writer.write(chunk);
      decryptedBytes += chunk.byteLength;
      chunks[nextToWrite] = null;
      nextToWrite++;
    }
    task.receivedBytes = decryptedBytes;
    task.segmentsDone = nextToWrite;
    task.progress = nextToWrite / Math.max(1, media.segments.length);
    update();
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

  let cursor = 0;
  const nextClaim = (): number | null => (cursor < media.segments.length ? cursor++ : null);

  if (media.initSegment) {
    const init = await fetchSegment(media.initSegment, signal);
    await writer.write(init);
    decryptedBytes += init.byteLength;
  }

  const pool = Array.from({ length: Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, media.segments.length) }, () => worker());
  await Promise.all(pool);
  await writeReady();
  task.segmentsDone = task.segmentsTotal;
  task.receivedBytes = decryptedBytes;
  task.progress = 1;
  update();
}

async function fetchPlaylist(url: string, signal: AbortSignal): Promise<{ url: string; body: string }> {
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Playlist HTTP ${response.status}`);
  const body = await response.text();
  if (!body.includes('#EXTM3U')) throw new Error('Not a valid m3u8 playlist');
  return { url, body };
}

async function fetchKey(key: HlsKey, signal: AbortSignal): Promise<CryptoKey> {
  if (!key.uri) throw new Error('Encryption key URI missing');
  const response = await fetch(key.uri, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Key fetch HTTP ${response.status} — the session that played this stream may be required`);
  const raw = await response.arrayBuffer();
  if (raw.byteLength !== 16) throw new Error(`Unexpected key size (${raw.byteLength} bytes)`);
  return crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt']);
}

async function fetchSegment(url: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= SEGMENT_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { signal, credentials: 'omit' });
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
  abort(): Promise<void>;
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
}
