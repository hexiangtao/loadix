import { lazy, Suspense } from 'react';
import { ModuleBoundary } from '../ModuleBoundary';
import { findTool } from './registry';

const lazyToolComponents = new Map<string, ReturnType<typeof lazy>>();

export function LazyToolView({ id, payload }: { id: string; payload?: string }) {
  const tool = findTool(id);
  if (!tool) return null;

  let Component = lazyToolComponents.get(id);
  if (!Component) {
    Component = lazy(tool.load) as ReturnType<typeof lazy>;
    lazyToolComponents.set(id, Component);
  }

  return (
    <ModuleBoundary label="Tool">
      <Suspense fallback={<ToolLoading />}>
        <Component key={payload ? `${id}:${payload}` : id} initialPayload={payload} />
      </Suspense>
    </ModuleBoundary>
  );
}

function ToolLoading() {
  return (
    <div className="flex min-h-[240px] items-center justify-center text-sm text-muted" role="status">
      <span className="mr-2 inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      Loading tool…
    </div>
  );
}
