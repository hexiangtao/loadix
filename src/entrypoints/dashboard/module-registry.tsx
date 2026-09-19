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

const MarkdownTool = lazy(() =>
  import('./markdown/MarkdownTool').then(({ MarkdownTool }) => ({ default: MarkdownTool })),
);
const ApiClientTool = lazy(() =>
  import('./api/ApiClientTool').then(({ ApiClientTool }) => ({ default: ApiClientTool })),
);
const MediaPanel = lazy(() =>
  import('./media/MediaPanel').then(({ MediaPanel }) => ({ default: MediaPanel })),
);

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
      <Suspense fallback={<ModuleLoading label="Loading Markdown…" />}>
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
      <Suspense fallback={<ModuleLoading label="Loading API client…" />}>
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
      <Suspense fallback={<ModuleLoading label="Loading media tools…" />}>
        <main className="h-[calc(100vh-3.5rem)] w-full overflow-hidden">
          <MediaPanel extensionMode={extensionMode} />
        </main>
      </Suspense>
    </ModuleBoundary>
  );
}

function ModuleLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-[240px] items-center justify-center text-sm text-muted" role="status">
      <span className="mr-2 inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </div>
  );
}

