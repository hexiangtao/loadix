// Read-only viewer for shared markdown documents (https://host/s/<id>).
//
// Deliberately lean: this page mounts only the markdown renderer, not the
// whole Loadix workbench. It fetches the stored *source* from the share API
// and re-renders with the same MarkdownPreview the tool uses — mermaid,
// KaTeX, GFM tables and highlighting all work with zero extra code.
//
// Product-consistent by design: the document renders flat on the same white
// surface and measure as the workbench preview, under a fixed header whose
// funnel link (打开工具箱) invites visitors into the product.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowUpRight, FileQuestion, Loader2, RotateCw } from 'lucide-react';
import { initI18n } from '@/entrypoints/dashboard/i18n';
import { MarkdownPreview } from '@/entrypoints/dashboard/markdown/MarkdownPreview';
import '@/entrypoints/dashboard/app.css';

const HOME_URL = 'https://loadix.dev';

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; source: string }
  | { status: 'not-found' }
  | { status: 'error' };

/**
 * Pulls the share id out of the URL. Two carriers, because hosts differ:
 *  - path /s/<id>: the Pages rewrite keeps the URL, so the id lives in the path;
 *  - query ?id=<id> (or ?share=<id>): some deployments redirect /s/* to a
 *    clean path, dropping the path id but preserving the query string — links
 *    carry the id redundantly so they survive both kinds of host.
 */
function shareIdFromUrl(): string | null {
  const fromPath = /\/s\/([A-Za-z0-9_-]{4,64})(?:\/|$)/.exec(window.location.pathname);
  if (fromPath) return fromPath[1] ?? null;
  const search = new URLSearchParams(window.location.search);
  const fromQuery = search.get('id') || search.get('share');
  return fromQuery && /^[A-Za-z0-9_-]{4,64}$/.test(fromQuery) ? fromQuery : null;
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
  const [id] = useState(shareIdFromUrl);
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

  return (
    <div className="flex h-screen flex-col bg-panel">
      <header className="shrink-0 border-b border-line bg-panel">
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
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-primary/90"
          >
            {t('share.openToolbox')}
            <ArrowUpRight size={13} />
          </a>
        </div>
      </header>

      <main className="app-scroller min-h-0 flex-1 overflow-y-auto">
        {/* The document is the hero, rendered flat on the same white surface
            and measure as the workbench's preview pane — preview and share
            stay consistent, so a shared visitor sees exactly the product.
            Wide tables and diagrams overflow-scroll in their own wrappers. */}
        <div className="mx-auto w-full max-w-[880px] px-6 py-8 sm:px-8 sm:py-10">
          {(state.status === 'loading' || state.status === 'ready') && (
            <div>
              {state.status === 'loading' && (
                <div aria-label={t('share.loading')} className="space-y-3" role="status">
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

              {state.status === 'ready' && <MarkdownPreview source={state.source} />}
            </div>
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
      </main>

      <footer className="shrink-0 border-t border-line py-5">
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
