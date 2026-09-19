/**
 * Media provider protocol.
 *
 * Providers are deliberately unaware of the UI and of the transport that
 * supplies `fetchText`. The same contract can therefore be used by the
 * browser resolver today and by a future yt-dlp/FFmpeg worker tomorrow.
 */

import type {
  FetchText,
  FetchTextOptions,
  ResolvedPageAsset,
} from './mediaResolver';

export type { FetchText, FetchTextOptions };
import { failureFromError, type ResolveFailure } from './resolveFailure';

export interface MediaProviderContext {
  pageUrl: string;
  fetchText: FetchText;
  report: (failure: ResolveFailure) => void;
  /** Optional cancellation from the host UI or a worker task timeout. */
  signal?: AbortSignal;
}

export interface MediaProvider {
  /** Stable provider id used in diagnostics and future worker routing. */
  id: string;
  /** Human-readable name for support hints and error reports. */
  label: string;
  /** Example URL shape shown in the UI. */
  example: string;
  /** URL-only capability check; must never perform network I/O. */
  match: (pageUrl: string) => boolean;
  /** Resolve one page, or return null when this provider cannot handle it. */
  resolve: (context: MediaProviderContext) => Promise<ResolvedPageAsset | null>;
}

/**
 * Description of a future remote provider. Keeping this beside the local
 * contract prevents the UI from learning whether a provider is local or a
 * worker-backed service.
 */
export interface RemoteMediaProviderDescriptor {
  id: string;
  endpoint: string;
  capabilities: readonly ('resolve' | 'download' | 'merge' | 'proxy')[];
  fetchOptions?: Pick<FetchTextOptions, 'headers'>;
}

export const MEDIA_PROVIDER_PROTOCOL_VERSION = 1 as const;

export interface ProviderResolveResult {
  provider: MediaProvider;
  asset: ResolvedPageAsset;
}

/**
 * Ordered local/remote provider registry. Matching stays URL-only and
 * execution is isolated: one provider can fail without preventing the next
 * provider from trying. This is the seam where a worker-backed provider can
 * be added later without changing the dashboard resolver.
 */
export class MediaProviderRegistry {
  readonly providers: readonly MediaProvider[];

  constructor(providers: readonly MediaProvider[]) {
    this.providers = providers;
  }

  list(): readonly MediaProvider[] {
    return this.providers;
  }

  async resolve(
    pageUrl: string,
    context: Omit<MediaProviderContext, 'pageUrl'>,
    signal?: AbortSignal,
  ): Promise<ProviderResolveResult | null> {
    for (const provider of this.providers) {
      if (!provider.match(pageUrl)) continue;
      try {
        const asset = await provider.resolve({ ...context, pageUrl, signal });
        if (asset) return { provider, asset: { ...asset, provider: asset.provider ?? provider.id } };
      } catch (error) {
        context.report(failureFromError(error, pageUrl));
      }
    }
    return null;
  }
}
