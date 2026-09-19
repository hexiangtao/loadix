import { describe, expect, it, vi } from 'vitest';
import { createRemoteMediaProvider } from './remoteMediaProvider';

const pageUrl = 'https://www.bilibili.com/video/BV1remote';
const asset = {
  title: 'Remote result',
  pageUrl,
  formats: [],
  dashOnly: false,
  notice: 'empty' as const,
};

function context(report: (failure: unknown) => void, signal?: AbortSignal) {
  return {
    pageUrl,
    fetchText: async () => '',
    report,
    signal,
  };
}

describe('remote media provider', () => {
  it('polls a queued worker task and tags the result with the provider id', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'task-1', state: 'queued' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'task-1', state: 'running' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'task-1', state: 'succeeded', result: asset })));
    const provider = createRemoteMediaProvider({
      id: 'yt-dlp-worker',
      endpoint: 'https://worker.example.test',
      capabilities: ['resolve', 'download', 'merge'],
      pollIntervalMs: 1_000,
      fetchImpl,
    });

    const result = await provider.resolve(context(() => undefined));
    expect(result?.provider).toBe('yt-dlp-worker');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://worker.example.test/resolve');
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://worker.example.test/tasks/task-1');
  });

  it('reports a worker failure instead of throwing into the resolver', async () => {
    const report = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ taskId: 'task-2', state: 'failed', failure: { reason: 'blocked', detail: 'WAF' } })),
    );
    const provider = createRemoteMediaProvider({ id: 'worker', endpoint: 'https://worker.test', capabilities: ['resolve'], fetchImpl });

    await expect(provider.resolve(context(report))).resolves.toBeNull();
    expect(report).toHaveBeenCalledWith({ reason: 'blocked', detail: 'WAF' });
  });

  it('matches only the configured hosts when a matcher is provided', () => {
    const provider = createRemoteMediaProvider({
      id: 'worker',
      endpoint: 'https://worker.test',
      capabilities: ['resolve'],
      matches: (url) => new URL(url).hostname.endsWith('example.com'),
    });
    expect(provider.match('https://video.example.com/x')).toBe(true);
    expect(provider.match('https://other.test/x')).toBe(false);
  });
});
