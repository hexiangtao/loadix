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
import { AssertionsPanel } from './panels/AssertionsPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { LoadPanel, type LoadFormValue } from './panels/LoadPanel';
import { RequestPanel, type RequestFormValue } from './panels/RequestPanel';
import { VariablesPanel } from './panels/VariablesPanel';
import { useUiStore } from './store/ui-store';
import { storageGet, storageSet } from './storage';

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

const DEFAULT_LOAD: LoadFormValue = { users: 10, rps: 5, duration: 30, ramp: 5 };
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

  const [request, setRequest] = useState<RequestFormValue>(DEFAULT_REQUEST);
  const [load, setLoad] = useState<LoadFormValue>(DEFAULT_LOAD);
  const [assertions, setAssertions] = useState<Assertion[]>(DEFAULT_ASSERTIONS);
  const [variables, setVariables] = useState<[string, string][]>([['token', '']]);
  const clientRef = useRef<EngineHost | null>(null);

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
        users: saved.users ?? DEFAULT_LOAD.users,
        rps: saved.rps ?? DEFAULT_LOAD.rps,
        duration: saved.duration ?? DEFAULT_LOAD.duration,
        ramp: saved.ramp ?? DEFAULT_LOAD.ramp,
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
    setLoad({ users: config.users, rps: config.rps, duration: config.duration, ramp: config.ramp });
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
      <header className="sticky top-0 z-5 flex h-16 items-center justify-between border-b border-line bg-panel px-6">
        <div>
          <b className="block text-[15px]">{t('app.name')}</b>
          <span className="mt-0.5 block text-[11px] text-muted">{t('app.subtitle')}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="ghost-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Light' : 'Dark'} aria-label="Toggle theme">
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
            className="rounded-lg border border-line bg-panel px-2 py-1.5 text-sm"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_LABELS[lang]}
              </option>
            ))}
          </select>
          <button className="ghost-btn" onClick={handleNew}>
            {t('app.newTest')}
          </button>
          <button className="ghost-btn" onClick={handleSave}>
            {t('app.saveConfig')}
          </button>
          <button className="ghost-btn" onClick={handleExport}>
            {t('app.exportReport')}
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)_380px] max-lg:grid-cols-1">
        {/* ——— Left: configuration ——— */}
        <section className="min-w-0 p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h1 className="mb-1 text-xl font-bold">{t(titleKey)}</h1>
              <p className="m-0 text-muted">{t(descKey)}</p>
            </div>
          </div>

          {/* Step tabs (horizontal) */}
          <div className="mb-4 flex gap-1 border-b border-line">
            {SECTIONS.map((section) => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`relative px-4 py-2.5 text-sm transition-colors duration-150 ${
                  activeSection === section ? 'font-semibold text-primary' : 'text-muted hover:text-ink'
                }`}
              >
                {t(`nav.${section}`)}
                {activeSection === section && (
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Panel with enter/exit transition */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {activeSection === 'request' && <RequestPanel value={request} onChange={setRequest} />}
              {activeSection === 'load' && <LoadPanel value={load} onChange={setLoad} />}
              {activeSection === 'assertions' && <AssertionsPanel value={assertions} onChange={setAssertions} />}
              {activeSection === 'variables' && <VariablesPanel value={variables} onChange={setVariables} />}
              {activeSection === 'history' && <HistoryPanel onRestore={handleRestore} />}
            </motion.div>
          </AnimatePresence>
        </section>

        {/* ——— Right: run + live monitor (sticky) ——— */}
        <aside className="min-w-0 border-l border-line bg-panel/40 p-5 max-lg:border-l-0 max-lg:border-t">
          <div className="sticky top-16 flex flex-col gap-4">
            <div className="rounded-xl border border-line bg-panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <div
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    running ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
                  }`}
                >
                  {running ? t('results.running') : t('results.idle')}
                </div>
                <span className="text-xs text-muted">{resultMessage || t('results.waiting')}</span>
              </div>
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  className="primary-btn flex-1"
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
              </div>
            </div>

            <MetricsGrid metrics={metrics} compact />

            <div className="chart-card">
              <div className="chart-title">{t('results.throughput')}</div>
              <div className="h-[120px]">
                <LineChart values={metrics?.throughput ?? []} />
              </div>
            </div>

            <div className="chart-card">
              <div className="chart-title">{t('results.latency')}</div>
              <div className="h-[120px]">
                <LineChart values={metrics?.latencySeries ?? []} />
              </div>
            </div>

            <div className="chart-card">
              <div className="chart-title">{t('results.breakdown')}</div>
              <Breakdown metrics={metrics} />
            </div>

            <div className="chart-card">
              <div className="chart-title">{t('results.recent')}</div>
              <RecentRequests metrics={metrics} />
            </div>
          </div>
        </aside>
      </main>
    </>
  );
}
