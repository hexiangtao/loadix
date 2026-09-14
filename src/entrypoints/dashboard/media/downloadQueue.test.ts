/**
 * The queue's whole reason to exist is that it starts the right number of
 * things at the right time, so these tests drive it with a fully manual
 * runner: nothing finishes unless a test says so.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_QUEUE_CONCURRENCY, DownloadQueue, type JobContext, type QueueJob } from './downloadQueue';
import type { DownloadHandle } from './hlsDownload';
import { createMediaTask, type MediaTask } from './mediaTypes';

interface Meta {
  url: string;
}

/** A runner whose downloads advance only when the test says so. */
function harness(concurrency = 2) {
  const started: string[] = [];
  const live = new Map<string, { task: MediaTask; finish: () => void; fail: (message: string) => void }>();

  const run = (job: QueueJob<Meta>, context: JobContext): DownloadHandle => {
    started.push(job.id);
    const task = createMediaTask(job.id, job.title, job.fileName);
    let settle: (value: MediaTask) => void = () => undefined;
    const promise = new Promise<MediaTask>((resolve) => {
      settle = resolve;
    });
    const emit = (state: MediaTask['state'], error?: string) => {
      task.state = state;
      task.error = error;
      context.callbacks.onTask?.({ ...task });
      settle({ ...task });
    };
    live.set(job.id, {
      task,
      finish: () => emit('done'),
      fail: (message) => emit('error', message),
    });
    return {
      task,
      promise,
      cancel: () => emit('canceled'),
    };
  };

  const queue = new DownloadQueue<Meta>({ run, concurrency });
  const job = (id: string): QueueJob<Meta> => ({ id, title: `title ${id}`, fileName: `${id}.mp4`, meta: { url: `https://cdn/${id}` } });
  return { queue, started, live, job };
}

/** Let the microtask queue drain so async settlement lands. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('DownloadQueue — concurrency', () => {
  it('starts no more than the cap and pulls the next job as slots free', async () => {
    const { queue, started, live, job } = harness(2);
    queue.addMany([job('a'), job('b'), job('c')]);

    expect(started).toEqual(['a', 'b']);
    expect(queue.entries.map((entry) => entry.state)).toEqual(['running', 'running', 'queued']);

    live.get('a')!.finish();
    await tick();
    expect(started).toEqual(['a', 'b', 'c']);

    live.get('b')!.finish();
    live.get('c')!.finish();
    await tick();
    expect(queue.entries.every((entry) => entry.state === 'done')).toBe(true);
  });

  it('defaults to a cap that keeps two streams busy', () => {
    expect(DEFAULT_QUEUE_CONCURRENCY).toBe(2);
  });

  it('numbers the waiting line so the dock can say "3rd in line"', () => {
    const { queue, job } = harness(1);
    queue.addMany([job('a'), job('b'), job('c')]);
    expect(queue.entries.map((entry) => entry.position)).toEqual([0, 1, 2]);
  });
});

describe('DownloadQueue — pause and resume', () => {
  it('stops starting new work but lets in-flight downloads finish', async () => {
    const { queue, started, live, job } = harness(1);
    queue.addMany([job('a'), job('b')]);
    expect(started).toEqual(['a']);

    queue.pause();
    live.get('a')!.finish();
    await tick();

    // The slot freed, but a paused queue deliberately leaves it empty.
    expect(started).toEqual(['a']);
    expect(queue.isPaused).toBe(true);

    queue.resume();
    expect(started).toEqual(['a', 'b']);
    expect(queue.isPaused).toBe(false);
  });
});

describe('DownloadQueue — cancel', () => {
  it('cancels a queued job without ever starting it', async () => {
    const { queue, started, live, job } = harness(1);
    queue.addMany([job('a'), job('b')]);
    queue.cancel('b');

    expect(started).toEqual(['a']);
    expect(queue.entries.find((entry) => entry.id === 'b')!.state).toBe('canceled');

    // The slot frees up, yet a job the user already dismissed must not start.
    live.get('a')!.finish();
    await tick();
    expect(started).toEqual(['a']);
  });

  it('aborts the download of a running job', async () => {
    const { queue, live, job } = harness(1);
    queue.add(job('a'));
    queue.cancel('a');
    expect(queue.entries[0]!.state).toBe('canceled');
    expect(live.get('a')!.task.state).toBe('canceled');
  });

  it('cancels a handle that arrives after the user already gave up', async () => {
    const handles: DownloadHandle[] = [];
    const queue = new DownloadQueue<Meta>({
      concurrency: 1,
      run: (job) => {
        // A part must resolve before it has formats, so the handle is late.
        return new Promise<DownloadHandle>((resolve) => {
          setTimeout(() => {
            const task = createMediaTask(job.id, job.title, job.fileName);
            const handle: DownloadHandle = {
              task,
              promise: Promise.resolve({ ...task }),
              cancel: () => {
                task.state = 'canceled';
              },
            };
            handles.push(handle);
            resolve(handle);
          }, 0);
        });
      },
    });

    queue.add({ id: 'p2', title: 'part 2', fileName: 'p2.mp4', meta: { url: 'u' } });
    expect(queue.entries[0]!.state).toBe('resolving');

    queue.cancel('p2');
    await tick();
    await tick();

    expect(handles).toHaveLength(1);
    expect(handles[0]!.task.state).toBe('canceled');
    expect(queue.entries[0]!.state).toBe('canceled');
  });
});

describe('DownloadQueue — retry', () => {
  it('re-runs a failed job with the same arguments', async () => {
    const { queue, started, live, job } = harness(1);
    queue.add(job('a'));
    live.get('a')!.fail('HTTP 403');
    await tick();

    expect(queue.entries[0]!.state).toBe('error');
    expect(queue.entries[0]!.error).toBe('HTTP 403');

    queue.retry('a');
    expect(started).toEqual(['a', 'a']);
    // One row per download — the retry replaces the failure, not stacks on it.
    expect(queue.entries).toHaveLength(1);
    expect(queue.entries[0]!.state).toBe('running');
  });

  it('retries only what failed, through one button', async () => {
    const { queue, started, live, job } = harness(3);
    queue.addMany([job('a'), job('b'), job('c')]);
    live.get('a')!.fail('boom');
    live.get('b')!.finish();
    live.get('c')!.fail('boom');
    await tick();

    queue.retryAll();
    expect(started).toEqual(['a', 'b', 'c', 'a', 'c']);
  });
});

describe('DownloadQueue — rows and ordering', () => {
  it('clears finished rows and keeps anything still in play', async () => {
    const { queue, live, job } = harness(1);
    queue.addMany([job('a'), job('b')]);
    live.get('a')!.finish();
    await tick();

    queue.clearFinished();
    expect(queue.entries.map((entry) => entry.id)).toEqual(['b']);
  });

  it('reorders only past other waiting jobs', () => {
    const { queue, job } = harness(1);
    queue.addMany([job('a'), job('b'), job('c'), job('d')]);
    // 'a' is running; moving 'b' up must jump over it.
    queue.move('b', -1);
    expect(queue.entries.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd']);

    queue.move('d', -1);
    expect(queue.entries.map((entry) => entry.id)).toEqual(['a', 'b', 'd', 'c']);

    // Running rows are not reorderable — it would not change when they start.
    queue.move('a', 1);
    expect(queue.entries.map((entry) => entry.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('keeps the snapshot reference stable until something actually changes', () => {
    const { queue, job } = harness(1);
    queue.add(job('a'));
    const first = queue.entries;
    expect(queue.entries).toBe(first);
    queue.pause();
    expect(queue.entries).not.toBe(first);
  });

  it('notifies subscribers and stops on unsubscribe', () => {
    const { queue, job } = harness(1);
    let calls = 0;
    const off = queue.subscribe(() => {
      calls += 1;
    });
    queue.add(job('a'));
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    off();
    queue.add(job('b'));
    expect(calls).toBe(seen);
  });
});
