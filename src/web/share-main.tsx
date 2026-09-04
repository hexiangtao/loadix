// Read-only viewer for shared markdown documents (https://host/s/<id>).
//
// Deliberately lean: this page mounts only the markdown renderer, not the
// whole Loadix workbench. It fetches the stored *source* from the share API
// and re-renders with the same MarkdownPreview the tool uses — mermaid,
// KaTeX, GFM tables and highlighting all work with zero extra code.
//
// The page doubles as a funnel: the workbench's real tool sidebar is mounted
// (collapsed by default) so a visitor can jump straight into any Loadix tool
// on the main site — see `toolFromUrl` in the dashboard App for the deep link.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowUpRight, FileQuestion, Loader2, RotateCw } from 'lucide-react';
import { initI18n } from '@/entrypoints/dashboard/i18n';
import { ToolsWorkspace } from '@/entrypoints/dashboard/tools/ToolsWorkspace';
import { MarkdownPreview } from '@/entrypoints/dashboard/tools/tools/MarkdownPreview';
import '@/entrypoints/dashboard/app.css';

const HOME_URL = 'https://loadix.dev';
const SIDEBAR_KEY = 'loadix-tools.sidebarCollapsed';

// First-time visitors should see the tool rail collapsed: the document is the
// hero, the icons are the discovery trail. The same key the workbench uses, so
// a returning visitor keeps whatever state they chose there.
try {
  if (localStorage.getItem(SIDEBAR_KEY) == null) localStorage.setItem(SIDEBAR_KEY, '1');
} catch {
  // Storage unavailable (private mode) — the workbench defaults to expanded.
}

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; source: string }
  | { status: 'not-found' }
  | { status: 'error' };

/** Pulls the share id out of a /s/<id> path (the browser keeps the URL during the Pages rewrite). */
function shareIdFromPath(): string | null {
  const m = /\/s\/([A-Za-z0-9_-]{4,64})(?:\/|$)/.exec(window.location.pathname);
  return m?.[1] ?? null;
}

/** Follows the OS theme by toggling `.dark` — the app's CSS tokens are var-based, so both themes work. */
function useSystemTheme() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
}

function ShareApp() {
  useSystemTheme();
  const { t } = useTranslation();
  const [id] = useState(shareIdFromPath);
  const [state, setState] = useState<ViewState>(() =>
    id ? { status: 'loading' } : { status: 'not-found' },
  );
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((a) => a + 1);

  // Fetch the stored source; retry re-runs this effect.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/share/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) throw Object.assign(new Error('not-found'), { code: 'not-found' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { source?: unknown } | null;
        if (cancelled) return;
        if (!data || typeof data.source !== 'string') {
          setState({ status: 'not-found' });
        } else {
          setState({ status: 'ready', source: data.source });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const code = (e as { code?: string } | null)?.code;
        setState({ status: code === 'not-found' ? 'not-found' : 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  useEffect(() => {
    if (state.status === 'ready') {
      document.title = 'Loadix · Shared document';
    }
  }, [state]);

  const openTool = (toolId: string) => {
    // Same-tab navigation into the real workbench (deep link: ?tool=<id>).
    window.location.assign(`/?tool=${encodeURIComponent(toolId)}`);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-panel/80 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-4 sm:px-6">
          <a
            href={HOME_URL}
            target="_blank"
            rel="noreferrer"
            title={t('share.home')}
            className="flex items-center gap-2 text-[15px] font-bold transition-colors duration-150 hover:text-primary"
          >
            <span className="size-2 rounded-full bg-primary" />
            Loadix
          </a>
          <a
            href={HOME_URL}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
          >
            {t('share.openToolbox')}
            <ArrowUpRight size={13} />
          </a>
        </div>
      </header>

      <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
        <ToolsWorkspace activeTool="__share_doc__" onSelect={openTool}>
          {/* Fluid document column: fills the space right of the tool rail so
              wide diagrams/tables/code actually use the monitor. */}
          <div className="w-full md-prose-wide">
            {state.status === 'loading' && (
              <div aria-label={t('share.loading')} className="space-y-3 pt-4" role="status">
                <div className="h-6 w-1/2 animate-pulse rounded-md bg-hover" />
                <div className="h-3 w-full animate-pulse rounded bg-hover" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-hover" />
                <div className="h-3 w-4/6 animate-pulse rounded bg-hover" />
                <div className="flex items-center gap-2 pt-2 text-xs text-muted">
                  <Loader2 size={13} className="animate-spin" />
                  {t('share.loading')}
                </div>
              </div>
            )}

            {state.status === 'ready' && (
              <article className="pb-10">
                <MarkdownPreview source={state.source} />
              </article>
            )}

            {(state.status === 'not-found' || state.status === 'error') && (
              <div className="flex flex-col items-center gap-4 pt-20 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-hover">
                  {state.status === 'not-found' ? (
                    <FileQuestion size={22} className="text-muted" />
                  ) : (
                    <AlertTriangle size={22} className="text-danger" />
                  )}
                </div>
                <p className="max-w-md text-sm text-muted">
                  {state.status === 'not-found' ? t('share.notFound') : t('share.loadError')}
                </p>
                <div className="flex items-center gap-2">
                  {state.status === 'error' && (
                    <button className="ghost-btn flex items-center gap-1.5" onClick={retry}>
                      <RotateCw size={13} />
                      {t('share.retry')}
                    </button>
                  )}
                  <a
                    className="ghost-btn flex items-center gap-1.5"
                    href={HOME_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('share.openToolbox')}
                  </a>
                </div>
              </div>
            )}
          </div>
        </ToolsWorkspace>
      </main>

      <footer className="border-t border-line py-5">
        <p className="text-center text-xs text-muted">
          {t('share.renderedBy')}
          <span className="mx-2 opacity-40">·</span>
          <a href={HOME_URL} target="_blank" rel="noreferrer" className="font-semibold hover:text-primary">
            {t('share.home')}
          </a>
        </p>
      </footer>
    </div>
  );
}

async function bootstrap() {
  await initI18n();
  const root = createRoot(document.getElementById('app')!);
  root.render(<ShareApp />);
}

void bootstrap();
