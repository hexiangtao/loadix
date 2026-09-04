import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { Assertion, TestConfig } from '@/shared/types';
import type { EngineHost } from '@/engine/engine-host';
import { changeLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from './i18n';
import { Breakdown } from './components/Breakdown';
import { LineChart } from './components/LineChart';
import { MetricsGrid } from './components/MetricsGrid';
import { RecentRequests } from './components/RecentRequests';
import { SlowRequests } from './components/SlowRequests';
import { AssertionFailures } from './components/AssertionFailures';
import { AssertionsPanel } from './panels/AssertionsPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { LoadPanel, type LoadFormValue } from './panels/LoadPanel';
import { RequestPanel, type RequestFormValue } from './panels/RequestPanel';
import { VariablesPanel } from './panels/VariablesPanel';
import { useUiStore } from './store/ui-store';
import { storageGet, storageSet } from './storage';
import { CommandPalette } from './tools/CommandPalette';
import { ToolsWorkspace } from './tools/ToolsWorkspace';
import { ToolsMenu } from './tools/ToolsMenu';
import { findTool } from './tools/registry';

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

const SECTION_META = {
  request: ['sections.request.title', 'sections.request.desc'],
  load: ['sections.load.title', 'sections.load.desc'],
  assertions: ['sections.assertions.title', 'sections.assertions.desc'],
  variables: ['sections.variables.title', 'sections.variables.desc'],
  history: ['sections.history.title', 'sections.history.desc'],
} as const;

const SECTIONS = ['request', 'load', 'assertions', 'variables', 'history'] as const;

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
};

export default function App({ host }: { host: EngineHost }) {
  const { t, i18n } = useTranslation();
  const { activeSection, engineState, resultMessage, metrics, setActiveSection, setEngineState, setMetrics, theme, setTheme } =
    useUiStore();

  const [view, setView] = useState<'loadtest' | 'tools'>(() =>
    localStorage.getItem('loadix-view') === 'tools' ? 'tools' : 'loadtest',
  );
  const [request, setRequest] = useState<RequestFormValue>(DEFAULT_REQUEST);
  const [load, setLoad] = useState<LoadFormValue>(DEFAULT_LOAD);
  const [assertions, setAssertions] = useState<Assertion[]>(DEFAULT_ASSERTIONS);
  const [variables, setVariables] = useState<[string, string][]>([['token', '']]);
  const [activeTool, setActiveTool] = useState<string | null>('base64');
  const [toolPayload, setToolPayload] = useState<string | undefined>(undefined);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const clientRef = useRef<EngineHost | null>(null);

  // Persist the active top-level view (load test vs tools).
  useEffect(() => {
    localStorage.setItem('loadix-view', view);
  }, [view]);

  const openTool = (id: string, payload?: string) => {
    setActiveTool(id);
    setToolPayload(payload);
    setView('tools');
  };

  const switchView = (v: 'loadtest' | 'tools') => {
    setView(v);
    if (v === 'loadtest') setActiveTool(null);
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

  const [titleKey, descKey] = SECTION_META[activeSection];

  return (
    <>
      <header className="toolbar flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <a
            href="https://loadix.dev"
            target="_blank"
            rel="noreferrer"
            title={t('app.name')}
            className="rounded-lg text-[15px] font-bold transition-colors duration-150 hover:text-primary"
          >
            {t('app.name')}
          </a>

          <nav className="flex items-center gap-1">
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
        </div>

        <div className="flex items-center gap-1">
          {view === 'loadtest' && (
            <>
              <motion.button
                whileTap={{ scale: 0.97 }}
                className="primary-btn"
                disabled={running}
                onClick={handleStart}
              >
                {t('results.start')}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                className="danger-btn"
                disabled={!running}
                onClick={handleStop}
              >
                {t('results.stop')}
              </motion.button>

              <span className="mx-2 h-6 w-px bg-line" />
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
              <button className="nav-btn" onClick={handleExport}>
                {t('app.exportReport')}
              </button>
            </>
          )}
        </div>
      </header>

      {view === 'loadtest' ? (
        <main className="mx-auto grid max-w-[1500px] grid-cols-[210px_minmax(0,1fr)]">
          {/* ——— Left: step navigation ——— */}
          <aside className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col p-3 pt-5">
            <div className="flex-1 overflow-y-auto">
              <div className="px-2.5 pb-3 text-xs font-bold text-muted">{t('nav.title')}</div>
              {SECTIONS.map((section) => (
                <button
                  key={section}
                  onClick={() => setActiveSection(section)}
                  className={`relative mb-0.5 w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-150 ${
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
                  <span className="relative">{t(`nav.${section}`)}</span>
                </button>
              ))}
            </div>
            <div className="px-2.5 pt-3 text-[11px] text-muted">
              <span className="mr-1.5 inline-block size-[7px] rounded-full bg-success" />
              {t('common.engineReady')}
            </div>
          </aside>

          {/* ——— Right: config + results ——— */}
          <section className="min-w-0 p-7" data-screenshot-target="loadtest">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h1 className="mb-1 text-xl font-bold">{t(titleKey)}</h1>
                <p className="m-0 text-muted">{t(descKey)}</p>
              </div>
              <div
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
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
                {activeSection === 'request' && <RequestPanel value={request} onChange={setRequest} />}
                {activeSection === 'load' && <LoadPanel value={load} onChange={setLoad} />}
                {activeSection === 'assertions' && <AssertionsPanel value={assertions} onChange={setAssertions} />}
                {activeSection === 'variables' && <VariablesPanel value={variables} onChange={setVariables} />}
                {activeSection === 'history' && <HistoryPanel onRestore={handleRestore} />}
              </motion.div>
            </AnimatePresence>

            <section className="mt-2">
              <div className="mb-3.5 flex items-center justify-between">
                <div>
                  <h2 className="mb-0.5 text-[17px] font-bold">{t('results.title')}</h2>
                  <span className="text-xs text-muted">{resultMessage || t('results.waiting')}</span>
                </div>
              </div>

              <MetricsGrid metrics={metrics} />

              <div className="mb-3 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
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

              <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
                <div className="chart-card">
                  <div className="chart-title">{t('results.breakdown')}</div>
                  <Breakdown metrics={metrics} />
                </div>
                <div className="chart-card">
                  <div className="chart-title">{t('results.assertionFailures')}</div>
                  <AssertionFailures metrics={metrics} />
                </div>
                <div className="chart-card">
                  <div className="chart-title">{t('results.slowest')}</div>
                  <SlowRequests metrics={metrics} />
                </div>
                <div className="chart-card">
                  <div className="chart-title">{t('results.recent')}</div>
                  <RecentRequests metrics={metrics} />
                </div>
              </div>
            </section>
          </section>
        </main>
      ) : (
        <main className="mx-auto w-full px-7 py-7">
          <ToolsWorkspace activeTool={activeTool ?? 'base64'} onSelect={openTool}>
            <ToolView id={activeTool ?? 'base64'} payload={toolPayload} />
          </ToolsWorkspace>
        </main>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSelect={openTool} />
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
