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
import { useAutoHideHeader } from '@/entrypoints/dashboard/useAutoHideHeader';
import { DocOutline } from '@/entrypoints/dashboard/markdown/DocOutline';
import { MarkdownPreview } from '@/entrypoints/dashboard/markdown/MarkdownPreview';
import { firstHeading } from '@/entrypoints/dashboard/markdown/docStore';
import { storageGet, storageSet } from '@/entrypoints/dashboard/storage';
import { useUiStore } from '@/entrypoints/dashboard/store/ui-store';
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

// Theme storage key shared with the app (App.tsx) — a visitor's light/dark
// choice persists across the dashboard and every shared page on this origin.
const THEME_KEY = 'api-pressure-theme';

function ShareApp() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const { t } = useTranslation();
  const [id] = useState(shareIdFromUrl);
  const [state, setState] = useState<ViewState>(() =>
    id ? { status: 'loading' } : { status: 'not-found' },
  );
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((a) => a + 1);

  // Restore the saved theme on mount (falling back to the OS preference),
  // then keep <html>'s .dark class and the stored value in sync with the
  // ui-store — the same mechanism as the app. Mermaid subscribes to the same
  // store, so diagrams re-render in the picked theme too.
  useEffect(() => {
    storageGet<'light' | 'dark'>(THEME_KEY).then((saved) => {
      setTheme(saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    });
  }, [setTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    storageSet(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  /* ——— Document outline (大纲) ———
     Lark/Feishu-style: the outline sits on the LEFT of the document. On
     desktop it starts EXPANDED (a shared visitor should see the feature, not
     hunt for it) and collapses only on purpose via the ✕ in its own header.
     On mobile it starts closed — the sheet is modal and would cover the
     document — with a floating pill as the entry point. One `outlineOpen`
     state drives both surfaces, only one active per breakpoint, so they never
     fight. Entering mobile closes the outline so an open desktop rail never
     auto-covers the doc as a modal. */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [outlineEnabled, setOutlineEnabled] = useState(false);
  const handleOutlineItems = useCallback((count: number) => setOutlineEnabled(count >= 2), []);
  // Whether we're on a small screen — the rail hides below lg and a sheet takes over.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches,
  );
  // Lark-style: on desktop the outline rail starts EXPANDED so shared visitors
  // discover the feature exists — they can only collapse it on purpose. On
  // mobile it starts closed instead: the sheet is modal, so auto-opening it
  // would cover the whole document the visitor came to read.
  const [outlineOpen, setOutlineOpen] = useState(
    () => !(typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches),
  );
  // Immersive reading like the dashboard: the top nav retreats while the
  // document scrolls down and returns on upward scroll / back at the top.
  const headerHidden = useAutoHideHeader(state.status === 'ready');
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
    <div className="flex h-screen flex-col overflow-hidden bg-panel">
      {/* The nav is FIXED (out of the layout flow): the document scroller below
          always spans the full viewport, and a top spacer inside the scrollable
          content keeps the first line clear while the nav is visible. Hiding /
          showing the nav therefore changes ZERO layout — no scroll-container
          resize, no scrollTop clamping or anchor feedback — so fast scrolling
          near the bottom of long documents can never fight the hide state.
          (A layout-based reclaim, e.g. pulling the content up with a negative
          margin, resizes the scroller each toggle and jitters.) */}
      <header
        className={`fixed inset-x-0 top-0 z-20 border-b border-line bg-panel transition-transform duration-300 ease-out ${
          headerHidden ? '-translate-y-full' : 'translate-y-0'
        }`}
      >
        <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6">
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
          <div className="flex shrink-0 items-center gap-1">
            {/* Night-mode toggle — mirrors the app's: flips light/dark, keeps
                the choice in storage so returning visitors and shared links
                open in the theme they last picked. */}
            <button
              type="button"
              className="nav-btn flex cursor-pointer items-center"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Light' : 'Dark'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
                </svg>
              )}
            </button>
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
        </div>
      </header>

      <main className="flex min-h-0 min-w-0 flex-1">
        {/* Outline rail — LEFT of the document (Lark-style), so the document's
            native scrollbar never sits between the two. Mounted whenever the
            doc is ready so it can report heading counts (which show the
            reopen control); the width animates so collapsing never jumps the
            document. Collapse lives in the rail's own header (the ✕ at its
            top-right) — the top nav stays for the brand and the home CTA
            only. On mobile it stays at width 0; the sheet takes over. */}
        {state.status === 'ready' && (
          <DocOutline
            containerRef={scrollerRef}
            source={state.source}
            onClose={() => setOutlineOpen(false)}
            onItemsChange={handleOutlineItems}
            className={`overflow-hidden transition-all duration-300 ease-out ${
              headerHidden ? '' : 'translate-y-[57px]'
            } ${outlineOpen ? 'lg:w-56' : ''} w-0`}
          />
        )}
        <div ref={scrollerRef} className="app-scroller sb-hairline min-h-0 min-w-0 flex-1 overflow-y-auto">
        {/* Top spacer: keeps the document's first line below the FIXED nav
            while it's visible. It scrolls away with the content, so when the
            nav hides the text can flow to the very top — reclaiming the nav's
            band without touching any layout. */}
        <div aria-hidden="true" className="h-14 shrink-0" />
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

              {/* Rendered media is click-to-zoom on the share page: diagrams
                  open full-size in a lightbox (vector-crisp) and images at
                  their natural resolution — never just the in-flow size. */}
              {state.status === 'ready' && <MarkdownPreview source={state.source} zoomable />}
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
        {/* Page footer lives at the END of the document, not pinned to the
            viewport — a fixed footer would sit in the reader's way while the
            document scrolls beneath it. It scrolls with the content and is
            only seen once the document ends. */}
        <footer className="border-t border-line py-5">
          <p className="text-center text-xs text-muted">
            <a href={HOME_URL} target="_blank" rel="noreferrer" className="font-semibold hover:text-primary">
              {t('share.home')}
            </a>
          </p>
        </footer>
        </div>
      </main>

      {/* Reopen control for a collapsed outline. Desktop: a slim handle that
          stays flush with the left edge where the rail used to be (reads as a
          collapsed drawer). Mobile: a floating pill, since the closed state
          leaves nothing else on screen. Hidden whenever the outline is open. */}
      {state.status === 'ready' && outlineEnabled && !outlineOpen && (
        <>
          <button
            type="button"
            onClick={() => setOutlineOpen(true)}
            title={t('tools.markdown.outline')}
            aria-label={t('tools.markdown.outline')}
            className="fixed left-0 top-1/2 z-30 hidden -translate-y-1/2 cursor-pointer items-center justify-center rounded-r-lg border border-l-0 border-line bg-panel py-2.5 pl-2 pr-1.5 text-muted shadow-sm transition-colors duration-150 hover:border-primary/40 hover:text-primary lg:flex"
          >
            <ListTree size={14} />
          </button>
          <button
            type="button"
            onClick={() => setOutlineOpen(true)}
            className="fixed bottom-5 right-4 z-30 flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-panel px-3.5 py-2 text-xs font-medium text-ink shadow-lg transition-colors duration-150 hover:border-primary/40 hover:text-primary lg:hidden"
          >
            <ListTree size={14} />
            {t('tools.markdown.outline')}
          </button>
        </>
      )}

      {/* Mobile outline: slide-in sheet from the left (below lg only), opened
          by the floating pill above; its own header carries the ✕ close. */}
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
    </div>
  );
}

async function bootstrap() {
  await initI18n();
  const root = createRoot(document.getElementById('app')!);
  root.render(<ShareApp />);
}

void bootstrap();
