import type { ResolvedPageAsset } from './mediaResolver';
import type {
  MediaProvider,
  MediaProviderContext,
  RemoteMediaProviderDescriptor,
} from './mediaProvider';
import type { ResolveFailure } from './resolveFailure';

export type RemoteTaskState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface RemoteTaskResponse {
  taskId: string;
  state: RemoteTaskState;
  result?: ResolvedPageAsset;
  failure?: ResolveFailure;
  retryAfterMs?: number;
}

export interface RemoteMediaProviderOptions extends RemoteMediaProviderDescriptor {
  /** Restrict the worker to selected hosts; omitted means every URL. */
  matches?: (pageUrl: string) => boolean;
  /** Polling interval for tasks that do not provide retryAfterMs. */
  pollIntervalMs?: number;
  /** Hard ceiling for a worker task. */
  timeoutMs?: number;
  /** Injectable for tests and non-browser hosts. */
  fetchImpl?: typeof fetch;
}

function endpointUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path}`;
}

function workerFailure(url: string, detail: string, reason: ResolveFailure['reason'] = 'backend'): ResolveFailure {
  let host: string | undefined;
  try { host = new URL(url).hostname; } catch { /* keep undefined */ }
  return { reason, host, detail: detail.slice(0, 240) };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return body;
}

/**
 * Create a provider backed by an external resolver/FFmpeg worker.
 *
 * The dashboard only sees the MediaProvider contract. The worker may resolve
 * directly or enqueue a task; this adapter handles both without exposing task
 * polling to the UI. It is opt-in: callers must provide a worker endpoint and
 * add the returned provider to their registry.
 */
export function createRemoteMediaProvider(options: RemoteMediaProviderOptions): MediaProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 800);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 30_000);

  return {
    id: options.id,
    label: options.id,
    example: 'https://example.com/video',
    match: options.matches ?? (() => true),
    async resolve(context: MediaProviderContext): Promise<ResolvedPageAsset | null> {
      const controller = new AbortController();
      const abort = () => controller.abort();
      context.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const start = await readJson(await fetchImpl(endpointUrl(options.endpoint, '/resolve'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...options.fetchOptions?.headers },
          body: JSON.stringify({ url: context.pageUrl }),
          signal: controller.signal,
        }));

        const immediate = start.result as ResolvedPageAsset | undefined;
        if (immediate) return { ...immediate, provider: immediate.provider ?? options.id };
        if (start.state === 'failed' || start.state === 'canceled') {
          context.report((start.failure as ResolveFailure | undefined) ?? workerFailure(context.pageUrl, `worker task ${start.state}`));
          return null;
        }
        const taskId = typeof start.taskId === 'string' ? start.taskId : '';
        if (!taskId) {
          context.report(workerFailure(context.pageUrl, 'worker returned no task id'));
          return null;
        }

        while (true) {
          if (controller.signal.aborted) {
            await fetchImpl(endpointUrl(options.endpoint, `/tasks/${encodeURIComponent(taskId)}`), {
              method: 'DELETE', signal: controller.signal,
            }).catch(() => undefined);
            return null;
          }
          const state = await readJson(await fetchImpl(endpointUrl(options.endpoint, `/tasks/${encodeURIComponent(taskId)}`), {
            signal: controller.signal,
          })) as unknown as RemoteTaskResponse;
          if (state.state === 'succeeded' && state.result) {
            return { ...state.result, provider: state.result.provider ?? options.id };
          }
          if (state.state === 'failed' || state.state === 'canceled') {
            context.report(state.failure ?? workerFailure(context.pageUrl, `worker task ${state.state}`));
            return null;
          }
          await new Promise<void>((resolve, reject) => {
            const wait = setTimeout(resolve, state.retryAfterMs ?? pollIntervalMs);
            controller.signal.addEventListener('abort', () => {
              clearTimeout(wait);
              reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
          });
        }
      } catch (error) {
        if (controller.signal.aborted && context.signal?.aborted) return null;
        context.report(workerFailure(context.pageUrl, error instanceof Error ? error.message : String(error), 'backend'));
        return null;
      } finally {
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', abort);
      }
    },
  };
}
