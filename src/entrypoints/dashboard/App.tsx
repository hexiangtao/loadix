import { useCallback, useEffect, useRef, useState } from 'react';
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

export default function App({ host }: { host: EngineHost }) {
  const { t, i18n } = useTranslation();
  const { activeSection, engineState, resultMessage, metrics, setActiveSection, setEngineState, setMetrics } = useUiStore();

  const [request, setRequest] = useState<RequestFormValue>(DEFAULT_REQUEST);
  const [load, setLoad] = useState<LoadFormValue>(DEFAULT_LOAD);
  const [assertions, setAssertions] = useState<Assertion[]>(DEFAULT_ASSERTIONS);
  const [variables, setVariables] = useState<[string, string][]>([['token', '']]);
  const clientRef = useRef<EngineHost | null>(null);

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
      <header className="sticky top-0 z-5 flex h-16 items-center justify-between border-b border-line bg-white px-6">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-indigo-50 text-lg">⚡</div>
          <div>
            <b className="block text-[15px]">{t('app.name')}</b>
            <span className="mt-0.5 block text-[11px] text-muted">{t('app.subtitle')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={i18n.language}
            onChange={(e) => void changeLanguage(e.target.value as SupportedLanguage)}
            className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang === 'en' ? 'English' : '简体中文'}
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

      <main className="mx-auto grid max-w-[1500px] grid-cols-[210px_minmax(0,1fr)]">
        <aside className="sticky top-16 h-[calc(100vh-4rem)] border-r border-line bg-white p-3 pt-5">
          <div className="px-2.5 pb-3 text-xs font-bold text-muted">{t('nav.title')}</div>
          {SECTIONS.map((section) => (
            <button
              key={section}
              className={`mb-0.5 w-full rounded-lg px-3 py-2.5 text-left text-[#536077] hover:bg-gray-50 ${
                activeSection === section ? 'bg-indigo-50 font-bold text-primary' : ''
              }`}
              onClick={() => setActiveSection(section)}
            >
              {t(`nav.${section}`)}
            </button>
          ))}
          <div className="absolute bottom-5 left-5 text-[11px] text-[#8b95a7]">
            <span className="mr-1.5 inline-block size-[7px] rounded-full bg-emerald-500" />
            {t('common.engineReady')}
          </div>
        </aside>

        <section className="min-w-0 p-7">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h1 className="mb-1 text-xl font-bold">{t(titleKey)}</h1>
              <p className="m-0 text-muted">{t(descKey)}</p>
            </div>
            <div
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                running ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {running ? t('results.running') : t('results.idle')}
            </div>
          </div>

          <RequestPanel value={request} onChange={setRequest} />
          <LoadPanel value={load} onChange={setLoad} />
          <AssertionsPanel value={assertions} onChange={setAssertions} />
          <VariablesPanel value={variables} onChange={setVariables} />
          <HistoryPanel onRestore={handleRestore} />

          <section className="mt-2">
            <div className="mb-3.5 flex items-center justify-between">
              <div>
                <h2 className="mb-0.5 text-[17px] font-bold">{t('results.title')}</h2>
                <span className="text-xs text-muted">{resultMessage || t('results.waiting')}</span>
              </div>
              <div className="flex gap-2">
                <button className="danger-btn" disabled={!running} onClick={handleStop}>
                  {t('results.stop')}
                </button>
                <button className="primary-btn" disabled={running} onClick={handleStart}>
                  {t('results.start')}
                </button>
              </div>
            </div>

            <MetricsGrid metrics={metrics} />

            <div className="mb-3 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
              <div className="chart-card h-[200px]">
                <div className="chart-title">{t('results.throughput')}</div>
                <LineChart values={metrics?.throughput ?? []} />
              </div>
              <div className="chart-card h-[200px]">
                <div className="chart-title">{t('results.latency')}</div>
                <LineChart values={metrics?.latencySeries ?? []} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
              <div className="chart-card">
                <div className="chart-title">{t('results.breakdown')}</div>
                <Breakdown metrics={metrics} />
              </div>
              <div className="chart-card">
                <div className="chart-title">{t('results.recent')}</div>
                <RecentRequests metrics={metrics} />
              </div>
            </div>
          </section>
        </section>
      </main>
    </>
  );
}
