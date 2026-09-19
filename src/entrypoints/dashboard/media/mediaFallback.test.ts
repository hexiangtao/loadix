import { afterEach, describe, expect, it } from 'vitest';
import { getMediaWorkerEndpoint, isWorthRemoteRetry, proxiedByWorker, setMediaWorkerEndpoint } from './mediaFallback';

const pageUrl = 'https://www.bilibili.com/video/BV1test/';

function asset(overrides: Partial<Parameters<typeof isWorthRemoteRetry>[0]> = {}) {
  return {
    title: 'x', pageUrl, formats: [], dashOnly: false, notice: 'empty' as const, ...overrides,
  };
}

describe('media worker fallback config', () => {
  afterEach(() => setMediaWorkerEndpoint(null));

  it('stores and clears a valid endpoint, rejecting junk', () => {
    setMediaWorkerEndpoint(' https://worker.example.com/ ');
    expect(getMediaWorkerEndpoint()).toBe('https://worker.example.com');
    setMediaWorkerEndpoint('ftp://nope');
    expect(getMediaWorkerEndpoint()).toBeNull();
  });

  it('retries remotely only for site-refusal failures or silent empty results', () => {
    expect(isWorthRemoteRetry(asset({ failure: { reason: 'blocked' } }))).toBe(true);
    expect(isWorthRemoteRetry(asset({ failure: { reason: 'login' } }))).toBe(true);
    expect(isWorthRemoteRetry(asset({ failure: { reason: 'drm' } }))).toBe(false);
    expect(isWorthRemoteRetry(asset({ failure: { reason: 'rate-limited' } }))).toBe(false);
    expect(isWorthRemoteRetry(asset())).toBe(true);
    expect(isWorthRemoteRetry(asset({ formats: [{ key: 'a', container: 'mp4' as const, quality: '720p', hasAudio: true, size: 1, url: 'https://cdn/v.mp4', backupUrls: [] }] }))).toBe(false);
  });

  it('routes downloads through the worker proxy only when configured', () => {
    const cdn = 'https://cdn.bilivideo.com/v.mp4';
    expect(proxiedByWorker(cdn)).toBe(cdn);
    setMediaWorkerEndpoint('https://worker.example.com');
    expect(proxiedByWorker(cdn)).toBe(`https://worker.example.com/download?url=${encodeURIComponent(cdn)}`);
  });
});
