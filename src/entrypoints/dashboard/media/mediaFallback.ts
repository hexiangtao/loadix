/**
 * Remote fallback configuration + helpers.
 *
 * The dashboard's local providers fail in two distinct places when a site
 * pushes back:
 *
 *   1. RESOLVE — the page/API can't be read from Cloudflare IPs (WAF, region).
 *   2. DOWNLOAD — the CDN refuses a proxied or foreign-Referer request.
 *
 * Both can be rescued by an external media worker (yt-dlp + streaming
 * proxy). This module centralizes how the app learns about such a worker:
 * a single localStorage-configurable endpoint, read lazily, never bundled.
 */

import { createRemoteMediaProvider } from './remoteMediaProvider';
import type { MediaProvider } from './mediaProvider';
import type { ResolvedPageAsset } from './mediaResolver';

const WORKER_ENDPOINT_KEY = 'loadix-media-worker-endpoint';

/** In-memory mirror so non-browser hosts (tests, workers without storage)
 *  still get a working config instead of silently disabled fallback. */
let memoryEndpoint: string | null = null;

/** Read the user- (or operator-) configured worker endpoint, if any. */
export function getMediaWorkerEndpoint(): string | null {
  try {
    const value = localStorage.getItem(WORKER_ENDPOINT_KEY)?.trim();
    if (value && /^https?:\/\//i.test(value)) return value.replace(/\/$/, '');
  } catch {
    /* storage unavailable — fall back to memory */
  }
  return memoryEndpoint;
}

export function setMediaWorkerEndpoint(endpoint: string | null): void {
  memoryEndpoint = endpoint && /^https?:\/\//i.test(endpoint.trim()) ? endpoint.trim().replace(/\/$/, '') : null;
  try {
    if (memoryEndpoint) localStorage.setItem(WORKER_ENDPOINT_KEY, memoryEndpoint);
    else localStorage.removeItem(WORKER_ENDPOINT_KEY);
  } catch {
    /* storage disabled — memory copy keeps the session working */
  }
}

/** True when the resolve is worth retrying remotely: the local chain got an
 *  answer, but the answer is "the site refused us" rather than "no media". */
export function isWorthRemoteRetry(asset: ResolvedPageAsset): boolean {
  const reason = asset.failure?.reason;
  if (reason) return reason === 'blocked' || reason === 'login' || reason === 'unavailable' || reason === 'network';
  // A resolve that produced no formats but no failure is the silent-degradation
  // case (a blocked UA, a refused API) — also worth one remote try.
  return asset.formats.length === 0 && asset.notice === 'empty';
}

/**
 * Build the remote provider for the configured endpoint, or null when unset.
 * The provider is created per call so endpoint changes take effect at once
 * without an app restart.
 */
export function remoteProviderIfConfigured(): MediaProvider | null {
  const endpoint = getMediaWorkerEndpoint();
  if (!endpoint) return null;
  return createRemoteMediaProvider({
    id: 'media-worker',
    endpoint,
    capabilities: ['resolve', 'download', 'merge'],
  });
}

/** Route a blocked CDN URL through the worker's streaming proxy. */
export function proxiedByWorker(url: string): string {
  const endpoint = getMediaWorkerEndpoint();
  if (!endpoint) return url;
  return `${endpoint}/download?url=${encodeURIComponent(url)}`;
}
