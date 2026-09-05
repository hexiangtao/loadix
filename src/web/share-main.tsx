// Read-only viewer for shared markdown documents (https://host/s/<id>).
//
// Deliberately lean: this page mounts only the markdown renderer, not the
// whole Loadix workbench. It fetches the stored *source* from the share API
// and re-renders with the same MarkdownPreview the tool uses — mermaid,
// KaTeX, GFM tables and highlighting all work with zero extra code.
//
// Product-consistent by design: the document renders flat on the same white
// surface and measure as the workbench preview, under a fixed header whose
// funnel link (返回首页) points visitors at the tool site (lab.loadix.dev),
// not the marketing site.
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowUpRight, FileQuestion, ListTree, Loader2, RotateCw } from 'lucide-react';
import { initI18n } from '@/entrypoints/dashboard/i18n';
import { DocOutline } from '@/entrypoints/dashboard/markdown/DocOutline';
import { MarkdownPreview } from '@/entrypoints/dashboard/markdown/MarkdownPreview';
import { firstHeading } from '@/entrypoints/dashboard/markdown/docStore';
import '@/entrypoints/dashboard/app.css';

const HOME_URL = 'https://loadix.dev';
// The tool site — where the shared document's product actually lives. The
// CTA and error-state links point here; the brand wordmark keeps the
// marketing site as its "home".
const LAB_URL = 'https://lab.loadix.dev';

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

  /* ——— Document outline (大纲) ———
     Lark/Feishu-style: the outline sits on the LEFT of the document and stays
     collapsed until the reader asks for it. One shared `outlineOpen` state
     drives both surfaces — only one is active per breakpoint, so they never
     fight: the desktop rail (non-modal, next to the content) and the mobile
     slide-in sheet. The header toggle appears once the doc actually has
     headings; the same button opens either surface. Entering mobile closes
     the outline so an open desktop rail never auto-covers the doc as a modal. */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [outlineEnabled, setOutlineEnabled] = useState(false);
  const handleOutlineItems = useCallback((count: number) => setOutlineEnabled(count >= 2), []);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // Whether we're on a small screen — the rail hides below lg and a sheet takes over.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const apply = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      if (mobile) setOutlineOpen(false);
    };
    mq.addEventListener('change', apply);
    apply();
    return () => mq.removeEventListener('change', apply);
  }, []);

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

  // The tab / link-preview title comes from the document's own first heading
  // (falling back to the generic brand line) so shared links carry real
  // context in chat apps and browsers.
  useEffect(() => {
    if (state.status === 'ready') {
      const heading = firstHeading(state.source);
      document.title = heading ? `${heading} · Loadix` : 'Shared document · Loadix';
    }
  }, [state]);

  return (
    <div className="flex h-screen flex-col bg-panel">
      <header className="shrink-0 border-b border-line bg-panel">
        <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <a
              href={HOME_URL}
              target="_blank"
              rel="noreferrer"
              title={t('share.home')}
              className="flex shrink-0 items-center gap-2 text-[15px] font-bold transition-colors duration-150 hover:text-primary"
            >
              <span className="size-2 rounded-full bg-primary" />
              Loadix
            </a>
            {/* Document outline (大纲), Lark-style: opens the left rail on
                desktop / the left sheet on mobile. Only appears once the
                document actually has headings to navigate. */}
            {state.status === 'ready' && outlineEnabled && (
              <button
                type="button"
                onClick={() => setOutlineOpen((v) => !v)}
                aria-pressed={outlineOpen}
                title={t('tools.markdown.outline')}
                aria-label={t('tools.markdown.outline')}
                className={`flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors duration-150 ${
                  outlineOpen
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-line bg-panel text-muted hover:border-primary hover:text-primary'
                }`}
              >
                <ListTree size={13} />
              </button>
            )}
          </div>
          {/* Restrained on purpose: the shared document is the hero, so the
              funnel CTA uses the app's quiet brand tint instead of a heavy
              filled button — present, but it never competes with the content. */}
          <a
            href={LAB_URL}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors duration-150 hover:bg-primary/15"
          >
            {t('share.backHome')}
            <ArrowUpRight size={13} />
          </a>
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        {/* Outline rail — LEFT of the document (Lark-style), so the document's
            native scrollbar never sits between the two. Always mounted once the
            doc is ready, so the header toggle stays truthful about whether the
            doc has headings; hidden on small screens (the sheet takes over). */}
        {state.status === 'ready' && (
          <DocOutline
            containerRef={scrollerRef}
            source={state.source}
            onItemsChange={handleOutlineItems}
            className={`h-full ${outlineOpen ? 'hidden lg:block' : 'hidden'}`}
          />
        )}
        <div ref={scrollerRef} className="app-scroller min-h-0 min-w-0 flex-1 overflow-y-auto">
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
                  href={LAB_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('share.backHome')}
                </a>
              </div>
            </div>
          )}
        </div>
        </div>
      </main>

      {/* Mobile outline: slide-in sheet from the left (below lg only), opened
          by the same header toggle as the desktop rail. */}
      {state.status === 'ready' && isMobile && outlineOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
          onClick={() => setOutlineOpen(false)}
          aria-hidden="true"
        />
      )}
      {state.status === 'ready' && isMobile && outlineOpen && (
        <div className="fixed inset-y-0 left-0 z-50 flex bg-panel shadow-2xl">
          <DocOutline
            containerRef={scrollerRef}
            source={state.source}
            onClose={() => setOutlineOpen(false)}
            onItemsChange={handleOutlineItems}
            className="h-full w-full"
          />
        </div>
      )}

      <footer className="shrink-0 border-t border-line py-5">
        <p className="text-center text-xs text-muted">
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
