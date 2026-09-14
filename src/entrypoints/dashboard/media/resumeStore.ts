/**
 * Resume partials — the retained state that lets an interrupted download
 * continue instead of starting over.
 *
 * Why a *retained writer* rather than "keep the half-written file and reopen
 * it": a `FileSystemWritableFileStream` buffers uncommitted writes and only
 * commits on `close()`. Holding the stream across a failure therefore leaves
 * NOTHING visible on disk — no truncated `video.mp4` masquerading as a
 * finished download — while the bytes are still there to append to. A retry
 * resumes writing at the stream's own position, so there is no seek/offset
 * drift, no temp-name to rename, and no risk of appending to a file whose
 * contents are not what we think they are.
 *
 * That choice has one honest limit: a partial lives for the *session*.
 * Closing the tab drops it, because the bytes were never committed. Persisting
 * across reloads would mean committing a partial file and then re-acquiring
 * filesystem permission on it — a different feature with a different UX
 * (a partial file the user can see, plus a second permission prompt), and it
 * is deliberately not what this store does.
 *
 * Invariant that makes the small API safe: **only idle partials are stored.**
 * The engine puts one here after an attempt fails or is canceled, and drops it
 * on success, so an eviction or a `drain()` can never pull the rug out from
 * under a download that is still running.
 */

/** One retained partial. `payload` is opaque to the store — the engine stores
 *  its sink there; tests store whatever is convenient. */
export interface ResumeRecord<T> {
  /** Bytes already accepted by the payload — the offset a resume appends at. */
  bytesWritten: number;
  /** Pipeline cursor (media segments written, for HLS). Meaningless to the
   *  store; carried so the pipeline can skip work it already did. */
  unitsDone: number;
  /** Fingerprint of the source those bytes came from. A changed source (token
   *  rotation, re-encoded ladder, different part) must NOT be resumed into. */
  signature: string;
  /** The retained sink, handed back to the engine on a resume. */
  payload: T;
  updatedAt: number;
}

/** Default cap: enough that a batch of failures keeps their partials, few
 *  enough that abandoning them cannot pin unbounded memory. Least-recently
 *  written is evicted first. */
export const DEFAULT_RESUME_LIMIT = 8;

export class ResumeStore<T> {
  private readonly records = new Map<string, ResumeRecord<T>>();
  private readonly limit: number;

  constructor(limit: number = DEFAULT_RESUME_LIMIT) {
    this.limit = Math.max(1, limit);
  }

  /** How many partials are currently held (for tests and diagnostics). */
  get size(): number {
    return this.records.size;
  }

  /** The partial for `key`, if any. Does not remove it. */
  get(key: string): ResumeRecord<T> | undefined {
    return this.records.get(key);
  }

  has(key: string): boolean {
    return this.records.has(key);
  }

  /**
   * Hold a partial. Returns whatever had to be evicted to stay under the cap
   * so the caller can discard it (the store never touches the payload — only
   * the engine knows how to release a sink).
   */
  put(key: string, record: ResumeRecord<T>): ResumeRecord<T>[] {
    this.records.delete(key);
    this.records.set(key, record);
    const evicted: ResumeRecord<T>[] = [];
    while (this.records.size > this.limit) {
      const oldest = this.records.keys().next();
      if (oldest.done) break;
      const victim = this.records.get(oldest.value)!;
      this.records.delete(oldest.value);
      evicted.push(victim);
    }
    return evicted;
  }

  /** Forget one partial and hand it back for the caller to release. */
  drop(key: string): ResumeRecord<T> | undefined {
    const record = this.records.get(key);
    if (record) this.records.delete(key);
    return record;
  }

  /** Forget everything (the user tidied the dock up; nothing is in flight). */
  drain(): ResumeRecord<T>[] {
    const all = [...this.records.values()];
    this.records.clear();
    return all;
  }
}
