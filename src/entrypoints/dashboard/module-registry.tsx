import { lazy, Suspense } from 'react';
import type { ModuleIntent } from './module-protocol';
import { ModuleBoundary } from './ModuleBoundary';

/** Top-level feature ids used by the dashboard shell. */
export type DashboardModuleId = 'markdown' | 'api' | 'media';

/** Metadata is intentionally small: the shell knows how to navigate, not how a feature is implemented. */
export const DASHBOARD_MODULES: Record<DashboardModuleId, { id: DashboardModuleId }> = {
  markdown: { id: 'markdown' },
  api: { id: 'api' },
  media: { id: 'media' },
};

export function isDashboardModule(id: string): id is DashboardModuleId {
  return id in DASHBOARD_MODULES;
}

const loadMarkdown = () => import('./markdown/MarkdownTool').then(({ MarkdownTool }) => ({ default: MarkdownTool }));
const loadApiClient = () => import('./api/ApiClientTool').then(({ ApiClientTool }) => ({ default: ApiClientTool }));
const loadMedia = () => import('./media/MediaPanel').then(({ MediaPanel }) => ({ default: MediaPanel }));

const MarkdownTool = lazy(loadMarkdown);
const ApiClientTool = lazy(loadApiClient);
const MediaPanel = lazy(loadMedia);

/** Warm the next feature while the user is hovering/focusing its nav item. */
export function preloadDashboardModule(id: DashboardModuleId): void {
  if (id === 'markdown') void loadMarkdown();
  if (id === 'api') void loadApiClient();
  if (id === 'media') void loadMedia();
}

interface MarkdownModuleProps {
  initialPayload?: string;
  fullscreen: boolean;
  chromeGone: boolean;
  onToggleFullscreen: () => void;
}

interface ApiModuleProps {
  onIntent: (intent: ModuleIntent) => void;
}

interface MediaModuleProps {
  extensionMode: boolean;
}

export function MarkdownModule(props: MarkdownModuleProps) {
  return (
    <ModuleBoundary label="Markdown">
      <Suspense fallback={<ModuleLoading kind="markdown" label="Loading Markdown…" />}>
        <main className={`w-full transition-all duration-300 ${props.chromeGone ? '-mt-14' : ''}`}>
          <MarkdownTool {...props} />
        </main>
      </Suspense>
    </ModuleBoundary>
  );
}

export function ApiModule({ onIntent }: ApiModuleProps) {
  return (
    <ModuleBoundary label="API client">
      <Suspense fallback={<ModuleLoading kind="api" label="Loading API client…" />}>
        <main className="h-[calc(100vh-3.5rem)] w-full overflow-hidden">
          <ApiClientTool
            onOpenInLoadTest={(request) => onIntent({ type: 'open-loadtest', request })}
            onOpenInMarkdown={(markdown) => onIntent({ type: 'open-markdown', markdown })}
          />
        </main>
      </Suspense>
    </ModuleBoundary>
  );
}

export function MediaModule({ extensionMode }: MediaModuleProps) {
  return (
    <ModuleBoundary label="Media tools">
      <Suspense fallback={<ModuleLoading kind="media" label="Loading media tools…" />}>
        <main className="h-[calc(100vh-3.5rem)] w-full overflow-hidden">
          <MediaPanel extensionMode={extensionMode} />
        </main>
      </Suspense>
    </ModuleBoundary>
  );
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-lg bg-line/70 ${className}`} />;
}

function ModuleLoading({ kind, label }: { kind: DashboardModuleId; label: string }) {
  return (
    <section className="min-h-[calc(100vh-3.5rem)] bg-surface px-5 py-5 text-muted sm:px-7" role="status" aria-live="polite" aria-label={label}>
      <div className="mx-auto w-full max-w-[1600px]">
        <div className="mb-5 flex items-center gap-3">
          <span className="inline-block size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <div>
            <p className="text-sm font-medium text-ink">{label}</p>
            <p className="mt-0.5 text-xs text-muted">Preparing the workspace…</p>
          </div>
        </div>
        {kind === 'media' && <MediaLoadingSkeleton />}
        {kind === 'markdown' && <MarkdownLoadingSkeleton />}
        {kind === 'api' && <ApiLoadingSkeleton />}
      </div>
    </section>
  );
}

function MediaLoadingSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
      <div className="flex gap-2 border-b border-line px-4 py-3"><SkeletonBlock className="h-8 w-24" /><SkeletonBlock className="h-8 w-24" /></div>
      <div className="space-y-5 p-5 sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row"><SkeletonBlock className="h-10 flex-1" /><SkeletonBlock className="h-10 w-24" /></div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3"><SkeletonBlock className="h-44 w-full" /><div className="grid gap-3 sm:grid-cols-3"><SkeletonBlock className="h-20" /><SkeletonBlock className="h-20" /><SkeletonBlock className="h-20" /></div></div>
          <div className="space-y-3 rounded-xl border border-line p-4"><SkeletonBlock className="h-4 w-28" /><SkeletonBlock className="h-10 w-full" /><SkeletonBlock className="h-10 w-full" /><SkeletonBlock className="h-10 w-full" /></div>
        </div>
        <p className="text-xs text-muted">Video tools are loading in the background. Your link will stay ready.</p>
      </div>
    </div>
  );
}

function MarkdownLoadingSkeleton() {
  return <div className="grid min-h-[calc(100vh-8rem)] overflow-hidden rounded-2xl border border-line bg-panel lg:grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.1fr)]"><div className="border-b border-line p-5 lg:border-b-0 lg:border-r"><SkeletonBlock className="mb-4 h-5 w-28" /><SkeletonBlock className="h-[calc(100vh-13rem)] w-full" /></div><div className="p-5"><SkeletonBlock className="mb-5 h-5 w-24" /><SkeletonBlock className="mb-4 h-8 w-3/4" /><SkeletonBlock className="mb-3 h-4 w-full" /><SkeletonBlock className="mb-3 h-4 w-5/6" /><SkeletonBlock className="mb-6 h-32 w-full" /><SkeletonBlock className="h-4 w-2/3" /></div></div>;
}

function ApiLoadingSkeleton() {
  return <div className="space-y-4 rounded-2xl border border-line bg-panel p-5 sm:p-7"><div className="flex gap-3"><SkeletonBlock className="h-10 w-24" /><SkeletonBlock className="h-10 flex-1" /><SkeletonBlock className="h-10 w-24" /></div><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"><SkeletonBlock className="h-[calc(100vh-12rem)]" /><SkeletonBlock className="h-[calc(100vh-12rem)]" /></div></div>;
}

