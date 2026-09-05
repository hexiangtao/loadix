import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { Assertion, TestConfig } from '@/shared/types';
import type { EngineHost } from '@/engine/engine-host';
import { changeLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from './i18n';
import { Breakdown } from './components/Breakdown';
import { LineChart } from './components/LineChart';
import { MetricsGrid } from './components/MetricsGrid';
import { HeroMetrics } from './components/HeroMetrics';
import { VerdictCard } from './components/VerdictCard';
import { ProgressBar } from './components/ProgressBar';
import { RecentRequests } from './components/RecentRequests';
import { SlowRequests } from './components/SlowRequests';
import { AssertionFailures } from './components/AssertionFailures';
import { ErrorGroups } from './components/ErrorGroups';
import { AssertionsPanel } from './panels/AssertionsPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { LoadPanel, type LoadFormValue } from './panels/LoadPanel';
import { RequestPanel, type RequestFormValue } from './panels/RequestPanel';
import { TargetBar } from './components/TargetBar';
import { VariablesPanel } from './panels/VariablesPanel';
import { useUiStore } from './store/ui-store';
import { RequestDetails } from './components/RequestDetails';
import { storageGet, storageSet } from './storage';
import { CommandPalette } from './tools/CommandPalette';
import { ToolsWorkspace } from './tools/ToolsWorkspace';
import { ToolsMenu } from './tools/ToolsMenu';
import { findTool } from './tools/registry';
import { MarkdownTool } from './markdown/MarkdownTool';
import { useAutoHideHeader } from './useAutoHideHeader';
import { PresetMenu } from './PresetMenu';
import { generateReport } from '@/shared/report';

const CONFIG_KEY = 'api-pressure-config';
const HISTORY_KEY = 'api-pressure-history';
const THEME_KEY = 'api-pressure-theme';

const DEFAULT_REQUEST: RequestFormValue = {
  method: 'GET',
  url: 'https://httpbin.org/get',
  timeout: 10000,
  headers: [['Accept', 'application/json']],
  body: '{"hello":"world"}',
  contentType: 'application/json',
};

const DEFAULT_LOAD: LoadFormValue = {
  loadModel: 'constant',
  users: 10,
  rps: 5,
  duration: 30,
  ramp: 0,
  stepUsers: 10,
  stepDuration: 10,
  spikeUsers: 100,
  spikeDuration: 10,
  maxErrorRate: 0,
  maxP95: 0,
};
const DEFAULT_ASSERTIONS: Assertion[] = [
  { type: 'status', value: '200' },
  { type: 'latency', value: '1000' },
];

// Section titles only — the original second tuple element (a `desc`
// tagline under each panel heading) was deleted in bulk because every
// one of them was filler copy that repeated what the form itself was
// already showing. If we ever need a real "what is this section for?"
// hint, add it back per-section as a `description` key, not as a
// paragraph under every heading.
const SECTION_TITLE_KEYS = {
  request: 'sections.request.title',
  load: 'sections.load.title',
  assertions: 'sections.assertions.title',
  variables: 'sections.variables.title',
  history: 'sections.history.title',
} as const;

const SECTIONS = ['request', 'load', 'assertions', 'variables', 'history'] as const;

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
};

/**
 * Deep link: /?tool=<id> (used by the share viewer's tool rail) opens the
 * tools workspace with that tool active on first load. The special id
 * `markdown` opens the top-level Markdown view instead.
 */
function toolFromUrl(): string | null {
  try {
    const id = new URLSearchParams(window.location.search).get('tool');
    return id && findTool(id) ? id : null;
  } catch {
    return null;
  }
}

export default function App({ host }: { host: EngineHost }) {
  const { t, i18n } = useTranslation();
  const { activeSection, engineState, resultMessage, metrics, setActiveSection, setEngineState, setMetrics, theme, setTheme, selectedRequest, setSelectedRequest } =
    useUiStore();

  const [view, setView] = useState<'loadtest' | 'tools' | 'markdown'>(() => {
    const tool = toolFromUrl();
    if (tool === 'markdown') return 'markdown';
    if (tool) return 'tools';
    const saved = localStorage.getItem('loadix-view');
    return saved === 'tools' || saved === 'markdown' ? saved : 'loadtest';
  });

  // Immersive mode: on the Markdown page the sticky header retreats while the
  // user scrolls the document, so reading/editing reclaims the full viewport.
  // Fullscreen reading (preview mode) forces the header away entirely.
  const [markdownFullscreen, setMarkdownFullscreen] = useState(false);
  const headerHidden = useAutoHideHeader(view === 'markdown' && !markdownFullscreen);
  const markdownChromeGone = view === 'markdown' && (markdownFullscreen || headerHidden);

  // Fullscreen reading only lives on the Markdown page — leaving it resets.
  useEffect(() => {
    if (view !== 'markdown') setMarkdownFullscreen(false);
  }, [view]);
  const [request, setRequest] = useState<RequestFormValue>(DEFAULT_REQUEST);
  const [load, setLoad] = useState<LoadFormValue>(DEFAULT_LOAD);
  const [assertions, setAssertions] = useState<Assertion[]>(DEFAULT_ASSERTIONS);
  const [variables, setVariables] = useState<[string, string][]>([['token', '']]);
  const [activeTool, setActiveTool] = useState<string | null>(() => toolFromUrl() ?? 'base64');
  const [toolPayload, setToolPayload] = useState<string | undefined>(undefined);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const clientRef = useRef<EngineHost | null>(null);

  // Persist the active top-level view (load test vs tools).
  useEffect(() => {
    localStorage.setItem('loadix-view', view);
  }, [view]);

  const openTool = (id: string, payload?: string) => {
    setActiveTool(id === 'markdown' ? null : id);
    setToolPayload(payload);
    setView(id === 'markdown' ? 'markdown' : 'tools');
  };

  const switchView = (v: 'loadtest' | 'tools' | 'markdown') => {
    setView(v);
    if (v !== 'tools') setActiveTool(null);
  };

  // Row-click handler used by Recent / Slowest / Error Groups to open the
  // request drawer. Wraps the store setter so children only need to know
  // about a non-null RequestResult, never about clearing.
  const showRequest = (r: import('@/shared/types').RequestResult) => {
    setSelectedRequest(r);
  };

  // Global Ctrl/Cmd+K opens the tool palette; Esc handled inside the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Restore saved theme on mount, then apply to <html>.
  useEffect(() => {
    storageGet<'light' | 'dark'>(THEME_KEY).then((saved) => {
      const initial = saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      setTheme(initial);
    });
  }, [setTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    storageSet(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  const running = engineState === 'running';

  // Connect to the engine host once; re-sync state after refresh.
  useEffect(() => {
    host.connect(setMetrics, setEngineState);
    clientRef.current = host;
  }, [host, setMetrics, setEngineState]);

  // Restore last saved config on mount.
  useEffect(() => {
    storageGet<Partial<TestConfig>>(CONFIG_KEY).then((saved) => {
      if (!saved) return;
      setRequest({
        method: saved.method ?? DEFAULT_REQUEST.method,
        url: saved.url ?? DEFAULT_REQUEST.url,
        timeout: saved.timeout ?? DEFAULT_REQUEST.timeout,
        headers: saved.headers ?? DEFAULT_REQUEST.headers,
        body: saved.body ?? DEFAULT_REQUEST.body,
        contentType: saved.contentType ?? DEFAULT_REQUEST.contentType,
      });
      setLoad({
        loadModel: saved.loadModel ?? DEFAULT_LOAD.loadModel,
        users: saved.users ?? DEFAULT_LOAD.users,
        rps: saved.rps ?? DEFAULT_LOAD.rps,
        duration: saved.duration ?? DEFAULT_LOAD.duration,
        ramp: saved.ramp ?? DEFAULT_LOAD.ramp,
        stepUsers: saved.stepUsers ?? DEFAULT_LOAD.stepUsers,
        stepDuration: saved.stepDuration ?? DEFAULT_LOAD.stepDuration,
        spikeUsers: saved.spikeUsers ?? DEFAULT_LOAD.spikeUsers,
        spikeDuration: saved.spikeDuration ?? DEFAULT_LOAD.spikeDuration,
        maxErrorRate: saved.maxErrorRate ?? 0,
        maxP95: saved.maxP95 ?? 0,
      });
      if (saved.assertions) setAssertions(saved.assertions);
      if (saved.variables) setVariables(saved.variables);
    });
  }, []);

  const buildConfig = useCallback(
    (): TestConfig => ({
      ...request,
      ...load,
      assertions,
      variables,
    }),
    [request, load, assertions, variables],
  );

  const handleStart = () => {
    if (!request.url.startsWith('http')) {
      alert(t('common.invalidUrl'));
      return;
    }
    // Body validation guard: when a method+content-type combo actually
    // carries a body, refuse to start with a malformed one — running a load
    // test against an invalid request just generates 400 noise.
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    if (hasBody && request.body.trim().length > 0) {
      if (request.contentType === 'application/json') {
        try {
          JSON.parse(request.body);
        } catch {
          alert(t('request.bodyInvalidJson'));
          return;
        }
      } else if (request.contentType === 'application/x-www-form-urlencoded') {
        try {
          new URLSearchParams(request.body);
        } catch {
          alert(t('request.bodyInvalidForm'));
          return;
        }
      }
    }
    clientRef.current?.start(buildConfig());
  };

  const handleStop = () => clientRef.current?.stop();

  const handleSave = () => {
    storageSet(CONFIG_KEY, buildConfig());
    alert(t('common.configSaved'));
  };

  const handleNew = () => {
    setRequest(DEFAULT_REQUEST);
    setLoad(DEFAULT_LOAD);
    setAssertions(DEFAULT_ASSERTIONS);
    setVariables([['token', '']]);
  };

  const handleExport = () => {
    const data = {
      generatedAt: new Date().toISOString(),
      config: buildConfig(),
      summary: metrics
        ? {
            requests: metrics.requests,
            success: metrics.success,
            errors: metrics.errors,
            avg: metrics.avg,
            p95: metrics.p95,
            p99: metrics.p99,
          }
        : null,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `api-pressure-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleExportHtml = () => {
    const html = generateReport({
      generatedAt: new Date().toISOString(),
      config: buildConfig(),
      metrics,
      resultMessage,
    });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `loadix-report-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleRestore = (config: TestConfig) => {
    setRequest({
      method: config.method,
      url: config.url,
      timeout: config.timeout,
      headers: config.headers,
      body: config.body,
      contentType: config.contentType,
    });
    setLoad({
      loadModel: config.loadModel ?? 'constant',
      users: config.users,
      rps: config.rps,
      duration: config.duration,
      ramp: config.ramp,
      stepUsers: config.stepUsers,
      stepDuration: config.stepDuration,
      spikeUsers: config.spikeUsers,
      spikeDuration: config.spikeDuration,
      maxErrorRate: config.maxErrorRate,
      maxP95: config.maxP95,
    });
    setAssertions(config.assertions);
    setVariables(config.variables);
  };

  const saveHistory = () => {
    storageGet<unknown[]>(HISTORY_KEY).then((list) => {
      const entry = {
        time: new Date().toISOString(),
        config: buildConfig(),
        requests: metrics?.requests ?? 0,
        avg: metrics?.avg ?? 0,
        p95: metrics?.p95 ?? 0,
        success: metrics?.success ?? 0,
      };
      storageSet(HISTORY_KEY, [entry, ...(list ?? [])].slice(0, 20));
    });
  };

  // Persist a history entry when a run finishes.
  useEffect(() => {
    if (engineState === 'finished' || engineState === 'aborted') saveHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState]);

  const titleKey = SECTION_TITLE_KEYS[activeSection];

  return (
    <>
      <header
        className={`toolbar flex h-14 items-center px-6 transition-transform duration-300 ${markdownChromeGone ? '-translate-y-full' : 'translate-y-0'}`}
      >
        <a
          href="https://loadix.dev"
          target="_blank"
          rel="noreferrer"
          title={t('app.name')}
          className="rounded-lg text-[15px] font-bold transition-colors duration-150 hover:text-primary"
        >
          {t('app.name')}
        </a>

        {/* Push the primary destinations to the right of the brand — the
            familiar brand-left / actions-right header — instead of crowding
            the Loadix wordmark. Contextual actions follow at the far right. */}
        <div className="flex-1" />

        <nav className="mr-2 flex items-center gap-1">
            <button
              onClick={() => switchView('markdown')}
              className={`relative rounded-lg px-3 py-2 text-sm transition-colors duration-150 ${
                view === 'markdown' ? 'font-bold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
              }`}
            >
              {view === 'markdown' && (
                <motion.span layoutId="view-active" className="absolute inset-0 rounded-lg bg-primary/10" />
              )}
              <span className="relative">{t('tools.markdown.name')}</span>
            </button>

            <button
              onClick={() => switchView('loadtest')}
              className={`relative rounded-lg px-3 py-2 text-sm transition-colors duration-150 ${
                view === 'loadtest' ? 'font-bold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
              }`}
            >
              {view === 'loadtest' && (
                <motion.span layoutId="view-active" className="absolute inset-0 rounded-lg bg-primary/10" />
              )}
              <span className="relative">{t('views.loadtest')}</span>
            </button>

            <span className="mx-1 h-6 w-px bg-line" />

            <ToolsMenu activeTool={activeTool} view={view} onSelect={(id) => openTool(id)} />
          </nav>

        <div className="flex items-center gap-1">
          {view === 'loadtest' && (
            <>
              {/* Start / Stop live in <TargetBar /> next to the URL they
                  act on, so the toolbar stays focused on document-level
                  actions (preset, theme, language, save, export). No
                  duplicate Stop here. */}
              <span className="mx-2 h-6 w-px bg-line" />
              <PresetMenu onApply={setLoad} />
            </>
          )}

          <button className="nav-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Light' : 'Dark'} aria-label="Toggle theme">
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
          <select
            value={i18n.language}
            onChange={(e) => void changeLanguage(e.target.value as SupportedLanguage)}
            className="cursor-pointer rounded-lg px-2 py-1.5 text-sm text-muted outline-none transition-colors duration-150 hover:bg-hover hover:text-ink"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_LABELS[lang]}
              </option>
            ))}
          </select>
          {view === 'loadtest' && (
            <>
              <button className="nav-btn" onClick={handleNew}>
                {t('app.newTest')}
              </button>
              <button className="nav-btn" onClick={handleSave}>
                {t('app.saveConfig')}
              </button>
              <button className="nav-btn" onClick={handleExport} title={t('app.exportJson')}>
                {t('app.exportJson')}
              </button>
              <button className="nav-btn" onClick={handleExportHtml} title={t('app.exportHtml')}>
                {t('app.exportHtml')}
              </button>
            </>
          )}
        </div>
      </header>

      {view === 'loadtest' ? (
        <main
          className="bg-panel max-xl:flex max-xl:flex-col max-xl:gap-6 max-xl:px-4 max-xl:py-5 xl:h-[calc(100vh-3.5rem)] xl:grid xl:grid-cols-[380px_minmax(0,1fr)] xl:overflow-hidden"
          data-screenshot-target="loadtest"
        >
          {/* ——— Left: step navigation + active configuration section ——— */}
          <aside className="flex min-w-0 flex-col max-xl:gap-4 xl:min-h-0 xl:overflow-hidden xl:border-r xl:border-line">
            <nav className="shrink-0 px-1 pb-2 pt-1 xl:px-2 xl:pb-2 xl:pt-2.5">
              <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-wide text-muted xl:px-1.5">
                {t('nav.title')}
              </div>
              {SECTIONS.map((section, idx) => (
                <button
                  key={section}
                  onClick={() => setActiveSection(section)}
                  className={`relative mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors duration-150 ${
                    activeSection === section ? 'font-bold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
                  }`}
                >
                  {activeSection === section && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-lg bg-primary/10"
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    />
                  )}
                  <span className="relative inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold opacity-70">
                    {idx + 1}
                  </span>
                  <span className="relative">{t(`nav.${section}`)}</span>
                </button>
              ))}
            </nav>

            <section className="app-scroller min-w-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:border-t xl:border-line xl:px-4 xl:py-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="min-w-0">
                  <h1 className="truncate text-[15px] font-bold">{t(titleKey)}</h1>
                </div>
                <div
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    running ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
                  }`}
                >
                  {running ? t('results.running') : t('results.idle')}
                </div>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeSection}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                >
                  {activeSection === 'request' && <RequestPanel value={request} onChange={setRequest} host={host} variables={variables} busy={running} />}
                  {activeSection === 'load' && <LoadPanel value={load} onChange={setLoad} />}
                  {activeSection === 'assertions' && <AssertionsPanel value={assertions} onChange={setAssertions} />}
                  {activeSection === 'variables' && <VariablesPanel value={variables} onChange={setVariables} />}
                   {activeSection === 'history' && <HistoryPanel onRestore={handleRestore} host={host} busy={running} />}
                </motion.div>
              </AnimatePresence>
            </section>
          </aside>

          {/* ——— Right: live results ——— */}
          <aside className="flex min-w-0 flex-col xl:min-h-0 xl:overflow-hidden">
            {/* Target API bar: pinned above the scrolling results so the URL
                + Start button stay reachable while the metrics stream. */}
            <div className="shrink-0 border-b border-line px-4 py-3">
            <TargetBar
              method={request.method}
              url={request.url}
              timeout={request.timeout}
              busy={running}
              onChange={(partial) => setRequest((r) => ({ ...r, ...partial }))}
              onStart={handleStart}
              onStop={handleStop}
            />
            </div>

            <div className="app-scroller flex min-w-0 flex-col gap-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:px-4 xl:pb-6 xl:pt-4">
            <ProgressBar running={running} durationSec={load.duration} />
            <VerdictCard engineState={engineState} metrics={metrics} resultMessage={resultMessage} autoStopHint={resultMessage} />
            <HeroMetrics metrics={metrics} target={load} />
            <MetricsGrid metrics={metrics} />

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="chart-card flex h-[200px] flex-col">
                <div className="chart-title">{t('results.throughput')}</div>
                <div className="min-h-0 flex-1">
                  <LineChart values={metrics?.throughput ?? []} unit="/s" />
                </div>
              </div>
              <div className="chart-card flex h-[200px] flex-col">
                <div className="chart-title">{t('results.latency')}</div>
                <div className="min-h-0 flex-1">
                  <LineChart values={metrics?.latencySeries ?? []} unit=" ms" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="chart-card">
                <div className="chart-title">{t('results.breakdown')}</div>
                <Breakdown metrics={metrics} />
              </div>
              <div className="chart-card">
                <div className="chart-title">{t('results.errorGroups')}</div>
                <ErrorGroups metrics={metrics} onSelect={showRequest} />
              </div>
              <div className="chart-card">
                <div className="chart-title">{t('results.assertionFailures')}</div>
                <AssertionFailures metrics={metrics} />
              </div>
              <div className="chart-card">
                <div className="chart-title">{t('results.slowest')}</div>
                <SlowRequests metrics={metrics} onSelect={showRequest} />
              </div>
              <div className="chart-card lg:col-span-2">
                <div className="chart-title">{t('results.recent')}</div>
                <RecentRequests metrics={metrics} onSelect={showRequest} />
              </div>
            </div>
            </div>
          </aside>
        </main>
      ) : view === 'markdown' ? (
        <main className={`w-full transition-all duration-300 ${markdownChromeGone ? '-mt-14' : ''}`}>
          <MarkdownTool
            initialPayload={toolPayload}
            fullscreen={markdownFullscreen}
            chromeGone={markdownChromeGone}
            onToggleFullscreen={() => setMarkdownFullscreen((v) => !v)}
          />
        </main>
      ) : (
        <main className="mx-auto w-full px-7 py-7">
          <ToolsWorkspace activeTool={activeTool ?? 'base64'} onSelect={openTool}>
            <ToolView id={activeTool ?? 'base64'} payload={toolPayload} />
          </ToolsWorkspace>
        </main>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSelect={openTool} />
      <RequestDetails
        request={selectedRequest}
        requestUrl={request.url}
        onClose={() => setSelectedRequest(null)}
      />
    </>
  );
}

/** Renders the active tool (from the registry). */
function ToolView({ id, payload }: { id: string; payload?: string }) {
  const tool = findTool(id);
  if (!tool) return null;
  const Component = tool.component;
  return <Component key={payload ? `${id}:${payload}` : id} initialPayload={payload} />;
}
