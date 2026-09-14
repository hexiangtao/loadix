/**
 * Download queue — bounded concurrency, and the state a downloader needs
 * that a bare `startDownload` call cannot carry.
 *
 * Why this exists: downloading is bandwidth-bound, so firing every part of a
 * twelve-part batch at once makes all twelve slower and none of them finish
 * sooner. The queue serialises the overflow and, more importantly, gives the
 * dock something to render beyond "clicked → done": position in line,
 * up/down reordering, cancel of something that has not started yet, and one
 * button that re-runs every failure.
 *
 * Two honesty constraints shaped the API:
 *
 *  1. **Pause stops *starting*, it does not suspend bytes.** A plain HTTP
 *     download has no resume point — a stream being written to a file handle
 *     cannot be frozen and thawed. Attempting it would silently corrupt
 *     output, so `pause()` means "keep the in-flight ones, start no more",
 *     and the UI says exactly that.
 *  2. **A job may need work before it has a handle.** Downloading part 2 of a
 *     multi-part video first resolves that part to formats. So a runner may
 *     return a handle or a promise of one, and the entry sits in `resolving`
 *     until it lands — or is abandoned if the user cancels meanwhile.
 *
 * Pure scheduling: the runner is injected, so tests drive the whole thing
 * with a fake and no network, no File System Access, no React.
 */

import type { DownloadCallbacks, DownloadHandle } from './hlsDownload';
import type { MediaTask } from './mediaTypes';

/** `resolving` = running, but before there is a task to report progress on. */
export type QueueState = 'queued' | 'resolving' | 'running' | 'done' | 'error' | 'canceled';

/** A row as the UI sees it — a snapshot, safe to render. */
export interface QueueEntry<T> {
  id: string;
  title: string;
  fileName: string;
  state: QueueState;
  /** Live task model once the download exists (null while queued/resolving). */
  task: MediaTask | null;
  error?: string;
  /** 1-based place in the waiting line; 0 once started. */
  position: number;
  /** Everything the runner needs to be invoked again — this is what makes
   *  retry one line of code instead of a retained closure per download. */
  meta: T;
}

/** What the caller hands in. */
export interface QueueJob<T> {
  id: string;
  title: string;
  fileName: string;
  meta: T;
}

/** Passed to the runner: the download's callbacks plus an abort signal so a
 *  runner can abandon work that happens *before* the handle exists. */
export interface JobContext {
  callbacks: DownloadCallbacks;
  signal: AbortSignal;
}

export type JobRunner<T> = (job: QueueJob<T>, context: JobContext) => DownloadHandle | Promise<DownloadHandle>;

export interface DownloadQueueOptions<T> {
  run: JobRunner<T>;
  /** Simultaneous downloads. Default 2 — two saturate a typical link without
   *  starving the browser's own requests. */
  concurrency?: number;
}

export const DEFAULT_QUEUE_CONCURRENCY = 2;

interface InternalItem<T> {
  job: QueueJob<T>;
  state: QueueState;
  task: MediaTask | null;
  error?: string;
  handle: DownloadHandle | null;
  controller: AbortController | null;
}

/** Terminal states — the ones the dock can clear, retry or leave alone. */
function isTerminal(state: QueueState): boolean {
  return state === 'done' || state === 'error' || state === 'canceled';
}

/** Map a task's own state onto the queue's vocabulary. A task reports
 *  `preparing` before it is really moving bytes, which the UI still shows as
 *  an active row. */
function fromTask(task: MediaTask): QueueState {
  if (task.state === 'done') return 'done';
  if (task.state === 'error') return 'error';
  if (task.state === 'canceled') return 'canceled';
  return 'running';
}

export class DownloadQueue<T> {
  private readonly run: JobRunner<T>;
  private readonly concurrency: number;
  private readonly items: InternalItem<T>[] = [];
  private readonly listeners = new Set<() => void>();
  private paused = false;
  /** Cached, reference-stable snapshot — `useSyncExternalStore` compares by
   *  identity, so rebuilding this on every read would loop forever. */
  private snapshot: QueueEntry<T>[] = [];

  constructor(options: DownloadQueueOptions<T>) {
    this.run = options.run;
    this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_QUEUE_CONCURRENCY);
  }

  get entries(): QueueEntry<T>[] {
    return this.snapshot;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Called whenever the snapshot changes. Returns an unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Number of downloads currently holding a slot. */
  get runningCount(): number {
    return this.items.filter((item) => item.state === 'resolving' || item.state === 'running').length;
  }

  /**
   * Enqueue a job. A job whose id is already present replaces it: the dock
   * shows one row per download, never one per attempt, so retrying a failed
   * row must not leave the old one behind.
   */
  add(job: QueueJob<T>): void {
    const at = this.items.findIndex((item) => item.job.id === job.id);
    if (at >= 0) {
      const existing = this.items[at]!;
      // Its slot is already busy — dropping the old handle is not enough,
      // the new job must wait its turn.
      existing.handle = null;
      existing.controller = null;
      existing.job = job;
      existing.state = 'queued';
      existing.task = null;
      existing.error = undefined;
      this.items.splice(at, 1);
      this.items.push(existing);
    } else {
      this.items.push({ job, state: 'queued', task: null, handle: null, controller: null });
    }
    this.emit();
    this.pump();
  }

  addMany(jobs: QueueJob<T>[]): void {
    for (const job of jobs) this.add(job);
  }

  /** Stop starting new jobs. In-flight downloads keep going — see the module
   *  header for why a real mid-stream pause is not on offer. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.emit();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.emit();
    this.pump();
  }

  cancel(id: string): void {
    const item = this.items.find((entry) => entry.job.id === id);
    if (!item || isTerminal(item.state)) return;
    // Two windows: a queued/resolving job has no handle to abort, so the
    // controller covers it and the runner is expected to honor the signal.
    item.controller?.abort();
    if (item.handle) {
      item.handle.cancel();
      // The handle reports `canceled` back through onTask; mark it now so the
      // row reacts immediately rather than on the next progress tick.
      item.state = 'canceled';
    } else {
      item.state = 'canceled';
    }
    item.handle = null;
    item.controller = null;
    this.emit();
    this.pump();
  }

  /** Re-run a failed or canceled job with the exact same arguments. */
  retry(id: string): void {
    const item = this.items.find((entry) => entry.job.id === id);
    if (!item || !isTerminal(item.state)) return;
    this.add(item.job);
  }

  /** One button for "everything that failed". */
  retryAll(): void {
    const failed = this.items.filter((item) => item.state === 'error' || item.state === 'canceled');
    for (const item of failed) this.add(item.job);
  }

  /** Drop finished rows, leaving anything still in play. */
  clearFinished(): void {
    for (let at = this.items.length - 1; at >= 0; at -= 1) {
      if (isTerminal(this.items[at]!.state)) this.items.splice(at, 1);
    }
    this.emit();
  }

  /** Move a still-waiting job up (`-1`) or down (`+1`) the line. Only
   *  neighbours that are themselves waiting are swapped with — dragging a job
   *  past a running one would not change when it starts. */
  move(id: string, delta: number): void {
    const at = this.items.findIndex((item) => item.job.id === id);
    if (at < 0 || this.items[at]!.state !== 'queued') return;
    let target = at + delta;
    while (target >= 0 && target < this.items.length && this.items[target]!.state !== 'queued') {
      target += delta;
    }
    if (target < 0 || target >= this.items.length) return;
    const [item] = this.items.splice(at, 1);
    this.items.splice(target, 0, item!);
    if (this.paused) this.emit();
    else this.pump();
  }

  /** Start as many jobs as the cap allows. */
  private pump(): void {
    if (this.paused) {
      this.emit();
      return;
    }
    for (const item of this.items) {
      if (this.runningCount >= this.concurrency) break;
      if (item.state !== 'queued') continue;
      this.start(item);
    }
    this.emit();
  }

  private start(item: InternalItem<T>): void {
    item.state = 'resolving';
    const controller = new AbortController();
    item.controller = controller;
    const callbacks: DownloadCallbacks = {
      // All three feed one settle path: hlsDownload reports a cancel through
      // onTask, not onError, so the state must be derived from the task
      // rather than from which callback fired.
      onTask: (task) => this.settle(item, task),
      onDone: (task) => this.settle(item, task),
      onError: (task) => this.settle(item, task),
    };

    // A handle that arrives synchronously adopts the running state AT ONCE.
    // Routing it through a promise would leave the row reading "resolving"
    // for a microtask, which is invisible to the eye but not to a cancel: the
    // user's click would land in the window where there was no handle to
    // abort, and the download would keep going.
    const adopt = (handle: DownloadHandle) => {
      // Canceled while resolving: the work arrived after the user lost
      // interest, so stop it now instead of downloading into the void.
      if (controller.signal.aborted) {
        handle.cancel();
        return;
      }
      item.handle = handle;
      this.settle(item, handle.task);
    };

    const fail = (err: unknown) => {
      if (controller.signal.aborted) return;
      item.state = 'error';
      item.error = err instanceof Error ? err.message : String(err);
      item.handle = null;
      item.controller = null;
      this.emit();
      this.pump();
    };

    try {
      const produced = this.run(item.job, { callbacks, signal: controller.signal });
      if (produced && typeof (produced as PromiseLike<DownloadHandle>).then === 'function') {
        (produced as Promise<DownloadHandle>).then(adopt, fail);
      } else {
        adopt(produced as DownloadHandle);
      }
    } catch (err) {
      fail(err);
    }
  }

  private settle(item: InternalItem<T>, task: MediaTask): void {
    item.task = task;
    const state = fromTask(task);
    if (isTerminal(state) && state === item.state) return;
    item.state = state;
    if (state === 'error') item.error = task.error;
    if (isTerminal(state)) {
      item.handle = null;
      item.controller = null;
    }
    this.emit();
    if (isTerminal(state)) this.pump();
  }

  private emit(): void {
    let waiting = 0;
    this.snapshot = this.items.map((item) => {
      const position = item.state === 'queued' ? (waiting += 1) : 0;
      return {
        id: item.job.id,
        title: item.job.title,
        fileName: item.job.fileName,
        state: item.state,
        task: item.task,
        error: item.error,
        position,
        meta: item.job.meta,
      };
    });
    for (const listener of this.listeners) listener();
  }
}
