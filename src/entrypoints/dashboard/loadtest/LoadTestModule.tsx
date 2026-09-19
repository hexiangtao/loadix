import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { FileCode, FileJson, Plus, Save } from 'lucide-react';
import type { ModuleIntent } from '../module-protocol';
import type { Assertion, ContentType, HttpMethod, TestConfig } from '@/shared/types';
import type { EngineHost } from '@/engine/engine-host';
import { generateReport } from '@/shared/report';
import { storageGet, storageSet } from '../storage';
import { useUiStore } from '../store/ui-store';
import { Breakdown } from '../components/Breakdown';
import { LineChart } from '../components/LineChart';
import { MetricsGrid } from '../components/MetricsGrid';
import { HeroMetrics } from '../components/HeroMetrics';
import { VerdictCard } from '../components/VerdictCard';
import { ProgressBar } from '../components/ProgressBar';
import { RecentRequests } from '../components/RecentRequests';
import { SlowRequests } from '../components/SlowRequests';
import { AssertionFailures } from '../components/AssertionFailures';
import { ErrorGroups } from '../components/ErrorGroups';
import { AssertionsPanel } from '../panels/AssertionsPanel';
import { HistoryPanel } from '../panels/HistoryPanel';
import { LoadPanel, type LoadFormValue } from '../panels/LoadPanel';
import { RequestPanel, type RequestFormValue } from '../panels/RequestPanel';
import { TargetBar } from '../components/TargetBar';
import { VariablesPanel } from '../panels/VariablesPanel';
import { PresetMenu } from '../PresetMenu';

const CONFIG_KEY = 'api-pressure-config';
const HISTORY_KEY = 'api-pressure-history';

export type LoadTestSection = 'request' | 'load' | 'assertions' | 'variables' | 'history';

interface LoadTestModuleProps {
  host: EngineHost;
  initialRequest?: Extract<ModuleIntent, { type: 'open-loadtest' }>['request'];
  onInitialRequestConsumed?: () => void;
}

const DEFAULT_REQUEST: RequestFormValue = {
  method: 'GET', url: 'https://httpbin.org/get', timeout: 10000,
  headers: [['Accept', 'application/json']], body: '{"hello":"world"}', contentType: 'application/json',
};
const DEFAULT_LOAD: LoadFormValue = {
  loadModel: 'constant', users: 10, rps: 5, duration: 30, ramp: 0,
  stepUsers: 10, stepDuration: 10, spikeUsers: 100, spikeDuration: 10, maxErrorRate: 0, maxP95: 0,
};
const DEFAULT_ASSERTIONS: Assertion[] = [{ type: 'status', value: '200' }, { type: 'latency', value: '1000' }];
const SECTIONS: LoadTestSection[] = ['request', 'load', 'assertions', 'variables', 'history'];
const SECTION_TITLE_KEYS: Record<LoadTestSection, string> = {
  request: 'sections.request.title', load: 'sections.load.title', assertions: 'sections.assertions.title',
  variables: 'sections.variables.title', history: 'sections.history.title',
};

export function LoadTestModule({ host, initialRequest, onInitialRequestConsumed }: LoadTestModuleProps) {
  const { t } = useTranslation();
  const { activeSection, engineState, resultMessage, metrics, setActiveSection, setEngineState, setMetrics, setSelectedRequest } = useUiStore();
  const [request, setRequest] = useState<RequestFormValue>(DEFAULT_REQUEST);
  const [load, setLoad] = useState<LoadFormValue>(DEFAULT_LOAD);
  const [assertions, setAssertions] = useState<Assertion[]>(DEFAULT_ASSERTIONS);
  const [variables, setVariables] = useState<[string, string][]>([['token', '']]);
  const clientRef = useRef<EngineHost | null>(null);
  const running = engineState === 'running';

  useEffect(() => {
    clientRef.current = host;
    host.connect(setMetrics, setEngineState);
  }, [host, setMetrics, setEngineState]);

  useEffect(() => {
    void storageGet<Partial<TestConfig>>(CONFIG_KEY).then((saved) => {
      if (!saved) return;
      setRequest({ method: saved.method ?? DEFAULT_REQUEST.method, url: saved.url ?? DEFAULT_REQUEST.url,
        timeout: saved.timeout ?? DEFAULT_REQUEST.timeout, headers: saved.headers ?? DEFAULT_REQUEST.headers,
        body: saved.body ?? DEFAULT_REQUEST.body, contentType: saved.contentType ?? DEFAULT_REQUEST.contentType });
      setLoad({ loadModel: saved.loadModel ?? DEFAULT_LOAD.loadModel, users: saved.users ?? DEFAULT_LOAD.users,
        rps: saved.rps ?? DEFAULT_LOAD.rps, duration: saved.duration ?? DEFAULT_LOAD.duration, ramp: saved.ramp ?? DEFAULT_LOAD.ramp,
        stepUsers: saved.stepUsers ?? DEFAULT_LOAD.stepUsers, stepDuration: saved.stepDuration ?? DEFAULT_LOAD.stepDuration,
        spikeUsers: saved.spikeUsers ?? DEFAULT_LOAD.spikeUsers, spikeDuration: saved.spikeDuration ?? DEFAULT_LOAD.spikeDuration,
        maxErrorRate: saved.maxErrorRate ?? 0, maxP95: saved.maxP95 ?? 0 });
      if (saved.assertions) setAssertions(saved.assertions);
      if (saved.variables) setVariables(saved.variables);
    });
  }, []);

  // API client opens the load-test module with a one-shot request prefill.
  useEffect(() => {
    if (!initialRequest) return;
    const isForm = initialRequest.body.type === 'form';
    const contentType: ContentType = initialRequest.body.type === 'json' ? 'application/json' : isForm ? 'application/x-www-form-urlencoded' : 'text/plain';
    setRequest({ method: (initialRequest.method === 'OPTIONS' ? 'POST' : initialRequest.method) as HttpMethod,
      url: initialRequest.url, timeout: 10000, headers: initialRequest.headers,
      body: isForm ? new URLSearchParams(initialRequest.body.form.filter(([key]) => key.trim())).toString() : initialRequest.body.content,
      contentType });
    onInitialRequestConsumed?.();
  }, [initialRequest, onInitialRequestConsumed]);

  const buildConfig = useCallback((): TestConfig => ({ ...request, ...load, assertions, variables }), [request, load, assertions, variables]);

  const handleStart = () => {
    if (!request.url.startsWith('http')) { alert(t('common.invalidUrl')); return; }
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    if (hasBody && request.body.trim()) {
      try {
        if (request.contentType === 'application/json') JSON.parse(request.body);
        else if (request.contentType === 'application/x-www-form-urlencoded') new URLSearchParams(request.body);
      } catch {
        alert(t(request.contentType === 'application/json' ? 'request.bodyInvalidJson' : 'request.bodyInvalidForm'));
        return;
      }
    }
    clientRef.current?.start(buildConfig());
  };
  const handleStop = () => clientRef.current?.stop();
  const handleSave = () => { void storageSet(CONFIG_KEY, buildConfig()); alert(t('common.configSaved')); };
  const handleNew = () => { setRequest(DEFAULT_REQUEST); setLoad(DEFAULT_LOAD); setAssertions(DEFAULT_ASSERTIONS); setVariables([['token', '']]); };
  const download = (content: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
  };
  const handleExport = () => download(JSON.stringify({ generatedAt: new Date().toISOString(), config: buildConfig(), summary: metrics ? {
    requests: metrics.requests, success: metrics.success, errors: metrics.errors, avg: metrics.avg, p95: metrics.p95, p99: metrics.p99,
  } : null }, null, 2), `api-pressure-report-${Date.now()}.json`, 'application/json');
  const handleExportHtml = () => download(generateReport({ generatedAt: new Date().toISOString(), config: buildConfig(), metrics, resultMessage }), `loadix-report-${Date.now()}.html`, 'text/html;charset=utf-8');
  const handleRestore = (config: TestConfig) => {
    setRequest({ method: config.method, url: config.url, timeout: config.timeout, headers: config.headers, body: config.body, contentType: config.contentType });
    setLoad({ loadModel: config.loadModel ?? 'constant', users: config.users, rps: config.rps, duration: config.duration, ramp: config.ramp,
      stepUsers: config.stepUsers, stepDuration: config.stepDuration, spikeUsers: config.spikeUsers, spikeDuration: config.spikeDuration,
      maxErrorRate: config.maxErrorRate, maxP95: config.maxP95 });
    setAssertions(config.assertions); setVariables(config.variables);
  };
  const saveHistory = () => {
    void storageGet<unknown[]>(HISTORY_KEY).then((list) => storageSet(HISTORY_KEY, [{ time: new Date().toISOString(), config: buildConfig(),
      requests: metrics?.requests ?? 0, avg: metrics?.avg ?? 0, p95: metrics?.p95 ?? 0, success: metrics?.success ?? 0 }, ...(list ?? [])].slice(0, 20)));
  };
  useEffect(() => { if (engineState === 'finished' || engineState === 'aborted') saveHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [engineState]);

  return (
    <main className="bg-panel max-xl:flex max-xl:flex-col max-xl:gap-6 max-xl:px-4 max-xl:py-5 xl:h-[calc(100vh-3.5rem)] xl:grid xl:grid-cols-[380px_minmax(0,1fr)] xl:overflow-hidden" data-screenshot-target="loadtest">
      <aside className="flex min-w-0 flex-col max-xl:gap-4 xl:min-h-0 xl:overflow-hidden xl:border-r xl:border-line">
        <div className="flex shrink-0 items-center justify-between gap-1 pl-2 pr-2 pt-2 xl:pl-3 xl:pr-3 xl:pt-2.5">
          <PresetMenu onApply={setLoad} />
          <div className="flex items-center gap-0.5">
            <button className="rounded-lg p-2 text-muted hover:bg-hover hover:text-ink" onClick={handleNew} title={t('app.newTest')} aria-label={t('app.newTest')}><Plus size={15} /></button>
            <button className="rounded-lg p-2 text-muted hover:bg-hover hover:text-ink" onClick={handleSave} title={t('app.saveConfig')} aria-label={t('app.saveConfig')}><Save size={15} /></button>
            <button className="rounded-lg p-2 text-muted hover:bg-hover hover:text-ink" onClick={handleExport} title={t('app.exportJson')} aria-label={t('app.exportJson')}><FileJson size={15} /></button>
            <button className="rounded-lg p-2 text-muted hover:bg-hover hover:text-ink" onClick={handleExportHtml} title={t('app.exportHtml')} aria-label={t('app.exportHtml')}><FileCode size={15} /></button>
          </div>
        </div>
        <nav className="shrink-0 px-1 pb-2 pt-1 xl:px-2 xl:pb-2 xl:pt-2.5">
          <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-wide text-muted xl:px-1.5">{t('nav.title')}</div>
          {SECTIONS.map((section, index) => <button key={section} onClick={() => setActiveSection(section)} className={`relative mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] ${activeSection === section ? 'font-bold text-primary' : 'text-muted hover:bg-hover hover:text-ink'}`}>
            {activeSection === section && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-primary/10" />}
            <span className="relative inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold opacity-70">{index + 1}</span><span className="relative">{t(`nav.${section}`)}</span>
          </button>)}
        </nav>
        <section className="app-scroller min-w-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:border-t xl:border-line xl:px-4 xl:py-4">
          <div className="mb-3 flex items-center justify-between"><h1 className="truncate text-[15px] font-bold">{t(SECTION_TITLE_KEYS[activeSection])}</h1><div className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${running ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>{running ? t('results.running') : t('results.idle')}</div></div>
          <AnimatePresence mode="wait" initial={false}><motion.div key={activeSection} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.16 }}>
            {activeSection === 'request' && <RequestPanel value={request} onChange={setRequest} host={host} variables={variables} busy={running} />}
            {activeSection === 'load' && <LoadPanel value={load} onChange={setLoad} />}
            {activeSection === 'assertions' && <AssertionsPanel value={assertions} onChange={setAssertions} />}
            {activeSection === 'variables' && <VariablesPanel value={variables} onChange={setVariables} />}
            {activeSection === 'history' && <HistoryPanel onRestore={handleRestore} host={host} busy={running} />}
          </motion.div></AnimatePresence>
        </section>
      </aside>
      <aside className="flex min-w-0 flex-col xl:min-h-0 xl:overflow-hidden">
        <div className="shrink-0 border-b border-line px-4 py-3"><TargetBar method={request.method} url={request.url} timeout={request.timeout} busy={running} onChange={(partial) => setRequest((current) => ({ ...current, ...partial }))} onStart={handleStart} onStop={handleStop} /></div>
        <div className="app-scroller flex min-w-0 flex-col gap-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:px-4 xl:pb-6 xl:pt-4">
          <ProgressBar running={running} durationSec={load.duration} /><VerdictCard engineState={engineState} metrics={metrics} resultMessage={resultMessage} autoStopHint={resultMessage} /><HeroMetrics metrics={metrics} target={load} /><MetricsGrid metrics={metrics} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2"><div className="chart-card flex h-[200px] flex-col"><div className="chart-title">{t('results.throughput')}</div><div className="min-h-0 flex-1"><LineChart values={metrics?.throughput ?? []} unit="/s" /></div></div><div className="chart-card flex h-[200px] flex-col"><div className="chart-title">{t('results.latency')}</div><div className="min-h-0 flex-1"><LineChart values={metrics?.latencySeries ?? []} unit=" ms" /></div></div></div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2"><div className="chart-card"><div className="chart-title">{t('results.breakdown')}</div><Breakdown metrics={metrics} /></div><div className="chart-card"><div className="chart-title">{t('results.errorGroups')}</div><ErrorGroups metrics={metrics} onSelect={setSelectedRequest} /></div><div className="chart-card"><div className="chart-title">{t('results.assertionFailures')}</div><AssertionFailures metrics={metrics} /></div><div className="chart-card"><div className="chart-title">{t('results.slowest')}</div><SlowRequests metrics={metrics} onSelect={setSelectedRequest} /></div><div className="chart-card lg:col-span-2"><div className="chart-title">{t('results.recent')}</div><RecentRequests metrics={metrics} onSelect={setSelectedRequest} /></div></div>
        </div>
      </aside>
    </main>
  );
}

// Keep the imported type visible to consumers that build feature manifests.
export type LoadTestStateSetter<T> = Dispatch<SetStateAction<T>>;
