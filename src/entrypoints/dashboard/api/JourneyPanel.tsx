import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, CircleAlert, Play, Plus, Route, Settings2, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { requestDisplayTitle, type ApiRequest } from './apiTypes';
import { createRequestNode, type Journey, type JourneyCondition, type JourneyNode, type JourneyRequestNode } from './journeyTypes';
import type { JourneyRunReport, JourneyStepResult } from './journeyRunner';

interface JourneyPanelProps {
  journeys: Journey[];
  activeId: string | null;
  requests: ApiRequest[];
  running: boolean;
  /** The most recent run (updated live while running). */
  report: JourneyRunReport | null;
  /** Known variables (env + global + extracted) for the binding pickers. */
  vars: Record<string, string>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onPatch: (journey: Journey) => void;
  onRun: (startAt?: number) => void;
  onStop: () => void;
  onLoadDemo: () => void;
  onLoadAuth: () => void;
  onOpenRequest: (id: string) => void;
  onExportReport: () => void;
  onClose: () => void;
}

function referencedVariables(request: ApiRequest): string[] {
  const text = [
    request.url,
    ...request.params.flat(),
    ...request.headers.flat(),
    request.body.content,
    request.body.gqlVariables,
    request.auth.token,
    request.auth.username,
    request.auth.password,
    request.auth.key,
    request.auth.value,
  ].join(' ');
  return Array.from(text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g), (match) => match[1]!).filter((name, index, all) => all.indexOf(name) === index);
}

function stepStatus(result: JourneyStepResult | undefined): 'pass' | 'fail' | 'skip' | 'idle' {
  if (!result) return 'idle';
  if (result.skipped) return 'skip';
  if (result.error || (result.response && !result.response.ok) || result.assertionFailures.length > 0) return 'fail';
  return 'pass';
}

/** Pretty-printed response body, truncated for preview. */
function previewBody(body: string, maxChars = 6000): string {
  try {
    const parsed = JSON.parse(body);
    body = JSON.stringify(parsed, null, 2);
  } catch {
    /* raw text */
  }
  return body.length > maxChars ? `${body.slice(0, maxChars)}\n… (truncated)` : body;
}

const statusChipClass: Record<string, string> = {
  pass: 'bg-success/12 text-success',
  fail: 'bg-danger/12 text-danger',
  skip: 'bg-muted/12 text-muted',
  idle: 'bg-primary/10 text-primary',
};

export function JourneyPanel({
  journeys, activeId, requests, running, report, vars,
  onSelect, onNew, onDelete, onPatch, onRun, onStop,
  onLoadDemo, onLoadAuth, onOpenRequest, onExportReport, onClose,
}: JourneyPanelProps) {
  const { t } = useTranslation();
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [settingsSteps, setSettingsSteps] = useState<Set<string>>(new Set());
  const [dataOpen, setDataOpen] = useState(false);
  const [customBinding, setCustomBinding] = useState<Record<string, boolean>>({});

  const active = journeys.find((journey) => journey.id === activeId) ?? null;
  const requestById = useMemo(() => new Map(requests.map((request) => [request.id, request])), [requests]);

  const toggle = (set: Set<string>, key: string, updater: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updater(next);
  };

  if (!active) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-panel">
        <PanelHeader onClose={onClose} running={running} onRun={onRun} onStop={onStop} showRun={false} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Route size={22} /></div>
          <p className="text-sm font-semibold text-ink">{t('api.journeyEmptyTitle')}</p>
          <p className="max-w-sm text-xs text-muted">{t('api.journeyEmptyHint')}</p>
          <button onClick={onNew} className="mt-1 flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90">
            <Plus size={13} />{t('api.journeyNew')}
          </button>
        </div>
      </div>
    );
  }

  const patchStep = (index: number, patch: Partial<JourneyRequestNode>) => {
    const steps = active.steps.map((step, i) => (i === index ? ({ ...(step as JourneyRequestNode), ...patch } as JourneyNode) : step));
    onPatch({ ...active, steps, updatedAt: Date.now() });
  };

  const lastIteration = report?.iterations[report.iterations.length - 1] ?? null;
  const resultByStep = useMemo(() => {
    const map = new Map<number, JourneyStepResult[]>();
    if (!report) return map;
    // Latest run: group per step index across iterations (last wins for badges).
    for (const iteration of report.iterations) {
      iteration.stepResults.forEach((result, stepIndex) => {
        const list = map.get(stepIndex) ?? [];
        list.push(result);
        map.set(stepIndex, list);
      });
    }
    return map;
  }, [report]);

  const dataRows = (() => {
    if (!active.data.trim() || !active.dataFormat) return 0;
    try {
      const parsed = JSON.parse(active.data);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return active.dataFormat === 'csv' ? active.data.split('\n').filter((line) => line.trim()).length - 1 : 0;
    }
  })();

  return (
    <div className="flex min-h-0 flex-1 bg-panel">
      {/* ——— Journey list rail ——— */}
      <div className="flex w-52 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{t('api.journeyList')}</span>
          <button onClick={onNew} title={t('api.journeyNew')} className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink">
            <Plus size={13} />
          </button>
        </div>
        <div className="app-scroller sb-hairline min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {journeys.length === 0 && <p className="px-2 py-3 text-[10px] text-muted">{t('api.journeyNoJourneys')}</p>}
          {journeys.map((journey) => (
            <div
              key={journey.id}
              onClick={() => onSelect(journey.id)}
              className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${journey.id === activeId ? 'bg-primary/10 text-ink' : 'text-muted hover:bg-hover hover:text-ink'}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold">{journey.name || t('api.journeyUntitled')}</p>
                <p className="text-[10px] text-muted">{journey.steps.length} {t('api.journeySteps')}</p>
              </div>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(journey.id);
                }}
                title={t('api.journeyDelete')}
                className="hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-danger/10 hover:text-danger group-hover:flex"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ——— Editor ——— */}
      <div className="flex min-w-0 flex-1 flex-col">
        <PanelHeader
          onClose={onClose}
          running={running}
          onRun={() => onRun()}
          onStop={onStop}
          showRun={active.steps.length > 0}
          report={report}
          onExportReport={onExportReport}
          active={active}
          onRename={(name) => onPatch({ ...active, name, updatedAt: Date.now() })}
        />

        <div className="app-scroller sb-hairline min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">{t('api.journeyEyebrow')}</p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">{active.name || t('api.journeyUntitled')}</h1>
                <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted">{t('api.journeyDescription')}</p>
                <label className="mt-2 flex w-fit cursor-pointer items-center gap-1.5 text-[11px] text-muted">
                  <input
                    type="checkbox"
                    checked={active.stopOnFailure}
                    onChange={(event) => onPatch({ ...active, stopOnFailure: event.target.checked, updatedAt: Date.now() })}
                    className="size-3 cursor-pointer accent-[var(--primary)]"
                  />
                  {t('api.journeyStopOnFailure')}
                </label>
              </div>
              <div className="hidden shrink-0 text-right sm:block">
                <div className="text-2xl font-semibold text-ink">{active.steps.length}</div>
                <div className="text-[11px] uppercase tracking-wider text-muted">{t('api.journeySteps')}</div>
              </div>
            </div>

            {/* ——— Dataset / iteration ——— */}
            <div className="mb-4 rounded-xl border border-line bg-surface/60">
              <button onClick={() => setDataOpen(!dataOpen)} className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left">
                {dataOpen ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
                <span className="text-[11px] font-semibold text-ink">{t('api.journeyData')}</span>
                {active.dataFormat && active.data.trim() && (
                  <span className="rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {dataRows} {t('api.journeyDataRows')}
                  </span>
                )}
              </button>
              {dataOpen && (
                <div className="border-t border-line px-4 py-4">
                  <p className="mb-2 text-[11px] text-muted">{t('api.journeyDataHint')}</p>
                  <div className="mb-2 flex items-center gap-2">
                    <select
                      value={active.dataFormat}
                      onChange={(event) => onPatch({ ...active, dataFormat: event.target.value as Journey['dataFormat'], updatedAt: Date.now() })}
                      className="field w-fit !py-1 !text-[11px]"
                    >
                      <option value="">{t('api.journeyDataNone')}</option>
                      <option value="json">JSON</option>
                      <option value="csv">CSV</option>
                    </select>
                    {active.dataFormat === 'json' && <span className="font-mono text-[11px] text-muted">[{t('api.journeyDataJsonHint')}]</span>}
                  </div>
                  <textarea
                    value={active.data}
                    onChange={(event) => onPatch({ ...active, data: event.target.value, updatedAt: Date.now() })}
                    placeholder={active.dataFormat === 'csv' ? 'id,name\n1,alice\n2,bob' : '[\n  { "id": "1" },\n  { "id": "2" }\n]'}
                    spellCheck={false}
                    className="field min-h-24 w-full resize-y font-mono !text-[11px]"
                  />
                  {report?.dataError && (
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-danger"><CircleAlert size={11} />{report.dataError}</p>
                  )}
                </div>
              )}
            </div>

            {/* ——— Steps ——— */}
            <div className="space-y-2.5">
              {active.steps.map((rawStep, index) => {
                const step = rawStep as JourneyRequestNode;
                const request = requestById.get(step.requestId);
                const results = resultByStep.get(index) ?? [];
                const result = results[results.length - 1];
                const status = stepStatus(result);
                const inputs = request ? referencedVariables(request) : [];
                const expanded = expandedSteps.has(`${index}`);
                const settingsOpen = settingsSteps.has(`${index}`);
                const failed = status === 'fail';
                return (
                  <div key={`${step.requestId}-${index}`} className={`relative rounded-xl border bg-surface/60 px-4 py-3.5 transition-colors hover:bg-surface/80 ${failed ? 'border-danger/40' : 'border-line'}`}>
                    {index < active.steps.length - 1 && <div className="absolute bottom-[-11px] left-[32px] z-10 h-3 w-px bg-line" />}
                    <div className="flex items-start gap-3.5">
                      <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold ${statusChipClass[status]}`}>
                        {status === 'pass' ? <Check size={15} strokeWidth={2.5} /> : status === 'skip' ? <ChevronRight size={14} /> : index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        {request ? (
                          <>
                            <button onClick={() => onOpenRequest(step.requestId)} className="block w-full cursor-pointer text-left">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-[10px] font-bold text-primary">{request.method}</span>
                                <span className="truncate text-[13px] font-semibold text-ink">{requestDisplayTitle(request, t('api.journeyUntitled'))}</span>
                                {request.extract.length > 0 && (
                                  <span className="rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                    {request.extract.length} {t('api.journeyExtracts')}
                                  </span>
                                )}
                                {(step.delayMs ?? 0) > 0 && <span className="rounded-full bg-muted/10 px-2 py-0.5 text-[10px] text-muted">{t('api.journeyDelayShort')} {step.delayMs}ms</span>}
                                {(step.retries ?? 0) > 0 && <span className="rounded-full bg-muted/10 px-2 py-0.5 text-[10px] text-muted">{t('api.journeyRetriesShort')} {step.retries}</span>}
                                {step.skipIf && <span className="rounded-full bg-muted/10 px-2 py-0.5 text-[10px] text-muted">{t('api.journeySkipped')}</span>}
                              </div>
                              <p className="mt-1 truncate font-mono text-[11px] text-muted">{request.url || t('api.journeyNoUrl')}</p>
                              {inputs.length > 0 && <p className="mt-1 text-[11px] text-warning">{t('api.journeyUses')}: {inputs.map((name) => `{{${name}}}`).join(', ')}</p>}
                            </button>
                            {inputs.map((target) => (
                              <BindingRow
                                key={target}
                                target={target}
                                source={step.bindings?.[target] ?? target}
                                stepIndex={index}
                                journey={active}
                                requestById={requestById}
                                vars={vars}
                                custom={customBinding[`${index}:${target}`] ?? false}
                                onCustomToggle={(custom) => setCustomBinding((prev) => ({ ...prev, [`${index}:${target}`]: custom }))}
                                onChange={(source) => {
                                  const bindings = { ...(step.bindings ?? {}), [target]: source };
                                  patchStep(index, { bindings });
                                }}
                                t={t}
                              />
                            ))}
                          </>
                        ) : (
                          <p className="flex items-center gap-1.5 text-[12px] text-danger">
                            <CircleAlert size={13} />
                            {t('api.journeyMissingRequest')}
                          </p>
                        )}
                        {settingsOpen && request && (
                          <StepSettings
                            step={step}
                            onChange={(patch) => patchStep(index, patch)}
                            t={t}
                          />
                        )}
                        {result && (
                          <ResultLine result={result} t={t} />
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-center gap-1">
                        <div className="flex items-center gap-1">
                          <button onClick={() => onRun(index)} disabled={running} title={t('api.journeyRunFromHere')} className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink disabled:opacity-20">
                            <Play size={12} />
                          </button>
                          <button onClick={() => toggle(expandedSteps, `${index}`, setExpandedSteps)} title={t('api.journeyDetail')} className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink">
                            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          <button onClick={() => toggle(settingsSteps, `${index}`, setSettingsSteps)} title={t('api.journeySettings')} className={`flex size-7 cursor-pointer items-center justify-center rounded-md ${settingsOpen ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-hover hover:text-ink'}`}>
                            <Settings2 size={13} />
                          </button>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => onPatch({ ...active, steps: moveStep(active.steps, index, -1), updatedAt: Date.now() })} disabled={index === 0} title={t('api.journeyMoveUp')} className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink disabled:opacity-20">
                            <ChevronUp size={14} />
                          </button>
                          <button onClick={() => onPatch({ ...active, steps: moveStep(active.steps, index, 1), updatedAt: Date.now() })} disabled={index === active.steps.length - 1} title={t('api.journeyMoveDown')} className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink disabled:opacity-20">
                            <ChevronDown size={14} />
                          </button>
                          <button onClick={() => onPatch({ ...active, steps: active.steps.filter((_, i) => i !== index), updatedAt: Date.now() })} title={t('api.journeyRemove')} className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                    {expanded && results.length > 0 && (
                      <StepDetail results={results} t={t} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* ——— Add step ——— */}
            <div className="mt-3 rounded-xl border border-dashed border-line bg-surface/30 p-4">
              <div className="flex items-center gap-2">
                <Plus size={14} className="text-primary" />
                <select
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return;
                    onPatch({
                      ...active,
                      steps: [...active.steps, createRequestNode(event.target.value)],
                      updatedAt: Date.now(),
                    });
                  }}
                  className="field min-w-0 flex-1 !py-1.5 !text-xs"
                >
                  <option value="">{t('api.journeyAdd')}</option>
                  {requests
                    .filter((request) => !active.steps.some((step) => (step as JourneyRequestNode).requestId === request.id))
                    .map((request) => (
                      <option key={request.id} value={request.id}>{request.method} {requestDisplayTitle(request, t('api.journeyUntitled'))}</option>
                    ))}
                </select>
              </div>
              {active.steps.length === 0 && <p className="mt-2 pl-6 text-[11px] text-muted">{t('api.journeyEmpty')}</p>}
            </div>

            {/* ——— Templates ——— */}
            {active.steps.length <= 1 && (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button onClick={onLoadDemo} className="flex cursor-pointer items-center justify-between rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/10">
                  <span>
                    <span className="block text-[11px] font-semibold text-primary">{t('api.journeyDemoTitle')}</span>
                    <span className="mt-0.5 block text-[10px] text-muted">{t('api.journeyDemoHint')}</span>
                  </span>
                  <Play size={13} className="shrink-0 text-primary" />
                </button>
                <button onClick={onLoadAuth} className="flex cursor-pointer items-center justify-between rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/10">
                  <span>
                    <span className="block text-[11px] font-semibold text-primary">{t('api.journeyAuthTitle')}</span>
                    <span className="mt-0.5 block text-[10px] text-muted">{t('api.journeyAuthHint')}</span>
                  </span>
                  <Play size={13} className="shrink-0 text-primary" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ——— Sub-components ——— */

function PanelHeader(props: {
  onClose: () => void;
  running: boolean;
  onRun: () => void;
  onStop: () => void;
  showRun: boolean;
  report?: JourneyRunReport | null;
  onExportReport?: () => void;
  active?: Journey;
  onRename?: (name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
      <button onClick={props.onClose} title={t('api.journeyClose')} className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink">
        <X size={15} />
      </button>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary"><Route size={15} /></div>
        {props.active && props.onRename ? (
          <input
            value={props.active.name}
            onChange={(event) => props.onRename!(event.target.value)}
            placeholder={t('api.journeyUntitled')}
            className="field w-40 !border-transparent !bg-transparent !px-1 !py-0.5 !text-[13px] !font-semibold focus:!border-line"
          />
        ) : (
          <h2 className="truncate text-[13px] font-semibold text-ink">{t('api.journeyTitle')}</h2>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {props.report && !props.running && (
          <>
            <span className="text-[10px] text-muted">
              {props.report.passedSteps} {t('api.journeyReportPassed')} · {props.report.failedSteps} {t('api.journeyReportFailed')} · {props.report.skippedSteps} {t('api.journeyReportSkipped')}
              {props.report.cancelled && ` · ${t('api.journeyStopped')}`}
            </span>
            <button onClick={props.onExportReport} className="flex cursor-pointer items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:bg-hover hover:text-ink">
              {t('api.journeyExportReport')}
            </button>
          </>
        )}
        {props.showRun &&
          (props.running ? (
            <button onClick={props.onStop} className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-danger/90">
              {t('api.journeyStop')}
            </button>
          ) : (
            <button onClick={props.onRun} className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-primary/90">
              <Play size={11} className="fill-current" />
              {t('api.journeyRun')}
            </button>
          ))}
      </div>
    </div>
  );
}

/** One binding row: `{{target}} ← source`, with a picker over earlier
 *  steps' extractions and known variables, plus a free-text fallback. */
function BindingRow(props: {
  target: string;
  source: string;
  stepIndex: number;
  journey: Journey;
  requestById: Map<string, ApiRequest>;
  vars: Record<string, string>;
  custom: boolean;
  onCustomToggle: (custom: boolean) => void;
  onChange: (source: string) => void;
  t: (key: string) => string;
}) {
  const { target, source, stepIndex, journey, requestById, vars, custom, onCustomToggle, onChange, t } = props;
  const stepOptions: { value: string; label: string }[] = [];
  journey.steps.forEach((step, index) => {
    if (index >= stepIndex) return;
    const request = requestById.get((step as JourneyRequestNode).requestId);
    for (const rule of request?.extract ?? []) {
      stepOptions.push({ value: `step:${index}:${rule.name}`, label: `${t('api.journeyStepShort')} ${index + 1} · ${rule.name}` });
    }
  });
  const varOptions = Object.keys(vars)
    .sort()
    .map((name) => ({ value: name, label: name }));
  const isCustom = custom || ![...stepOptions, ...varOptions].some((option) => option.value === source);
  const known = [...stepOptions, ...varOptions];

  return (
    <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
      <span className="shrink-0 font-mono text-warning">{`{{${target}}}`}</span>
      <span className="shrink-0">←</span>
      {isCustom ? (
        <input
          value={source}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => onCustomToggle(false)}
          placeholder={t('api.journeySourcePlaceholder')}
          className="field !w-40 !px-1.5 !py-0.5 !text-[11px]"
        />
      ) : (
        <select
          value={source}
          onChange={(event) => {
            if (event.target.value === '__custom__') {
              onCustomToggle(true);
              return;
            }
            onChange(event.target.value);
          }}
          className="field !w-40 !px-1.5 !py-0.5 !text-[11px]"
        >
          {stepOptions.length > 0 && (
            <optgroup label={t('api.journeyFromSteps')}>
              {stepOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
          )}
          {varOptions.length > 0 && (
            <optgroup label={t('api.journeyFromVars')}>
              {varOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
          )}
          <option value="__custom__">{t('api.journeyCustomVar')}…</option>
        </select>
      )}
      {known.length > 0 && (
        <button onClick={() => onCustomToggle(!isCustom)} className="cursor-pointer text-[10px] text-primary/70 hover:text-primary">
          {isCustom ? t('api.journeyPick') : t('api.journeyType')}
        </button>
      )}
    </label>
  );
}

function StepSettings(props: {
  step: JourneyRequestNode;
  onChange: (patch: Partial<JourneyRequestNode>) => void;
  t: (key: string) => string;
}) {
  const { step, onChange, t } = props;
  const skip = step.skipIf;
  return (
    <div className="mt-3 grid gap-x-4 gap-y-2.5 rounded-xl border border-line bg-surface/50 p-4 sm:grid-cols-3">
      <NumberField label={t('api.journeyDelay')} value={step.delayMs ?? 0} onChange={(value) => onChange({ delayMs: value })} t={t} />
      <NumberField label={t('api.journeyRetries')} value={step.retries ?? 0} onChange={(value) => onChange({ retries: value })} t={t} />
      <NumberField label={t('api.journeyRetryDelay')} value={step.retryDelayMs ?? 500} onChange={(value) => onChange({ retryDelayMs: value })} t={t} />
      <NumberField label={t('api.journeyTimeout')} value={step.timeoutMs ?? 0} onChange={(value) => onChange({ timeoutMs: value })} t={t} />
      <div className="sm:col-span-3">
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={Boolean(skip)}
            onChange={(event) => onChange({ skipIf: event.target.checked ? { source: 'prevStatus', op: 'eq', value: '200' } : undefined })}
            className="size-3 cursor-pointer accent-[var(--primary)]"
          />
          {t('api.journeySkip')}
        </label>
        {skip && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <select
              value={skip.source}
              onChange={(event) => onChange({ skipIf: { ...skip, source: event.target.value as JourneyCondition['source'] } })}
              className="field w-fit !px-1.5 !py-0.5 !text-[11px]"
            >
              <option value="prevStatus">{t('api.journeySkipStatus')}</option>
              <option value="prevBody">{t('api.journeySkipBody')}</option>
            </select>
            <select
              value={skip.op}
              onChange={(event) => onChange({ skipIf: { ...skip, op: event.target.value as JourneyCondition['op'] } })}
              className="field w-fit !px-1.5 !py-0.5 !text-[11px]"
            >
              {skip.source === 'prevStatus' ? (
                <>
                  <option value="eq">=</option>
                  <option value="ne">≠</option>
                </>
              ) : (
                <>
                  <option value="contains">{t('api.journeySkipContains')}</option>
                  <option value="notContains">{t('api.journeySkipNotContains')}</option>
                </>
              )}
            </select>
            <input
              value={skip.value ?? ''}
              onChange={(event) => onChange({ skipIf: { ...skip, value: event.target.value } })}
              placeholder={skip.source === 'prevStatus' ? '200' : t('api.journeySkipValuePlaceholder')}
              className="field !w-36 !px-1.5 !py-0.5 !text-[11px]"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  t: (key: string) => string;
}) {
  const { label, value, onChange } = props;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        className="field !px-1.5 !py-0.5 !text-[11px]"
      />
    </label>
  );
}

function ResultLine(props: { result: JourneyStepResult; t: (key: string) => string }) {
  const { result, t } = props;
  const tone = result.skipped ? 'text-muted' : result.error || (result.response && !result.response.ok) || result.assertionFailures.length > 0 ? 'text-danger' : 'text-success';
  return (
    <div className={`ml-0 mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${tone}`}>
      {result.skipped && <span>{t('api.journeySkipped')}</span>}
      {!result.skipped && result.error && <span className="flex items-center gap-1"><CircleAlert size={11} />{result.error}</span>}
      {!result.skipped && result.response && <span>{result.response.status || 'ERR'} {result.response.statusText} · {result.response.ms.toFixed(0)} ms{result.attempts > 1 ? ` · ${result.attempts}×` : ''}</span>}
      {result.extracted.length > 0 && <span>{t('api.journeyExtracted')}: {result.extracted.join(', ')}</span>}
      {result.assertionFailures.length > 0 && <span>{t('api.journeyFailed')}: {result.assertionFailures.join(', ')}</span>}
    </div>
  );
}

function StepDetail(props: { results: JourneyStepResult[]; t: (key: string) => string }) {
  const { results, t } = props;
  return (
    <div className="mt-3 space-y-2.5 border-t border-line pt-3">
      {results.map((result, index) => {
        const label = results.length > 1 ? `${t('api.journeyIteration')} ${index + 1}` : t('api.journeyDetail');
        if (result.skipped) {
          return <p key={index} className="text-[11px] text-muted">{label}: {t('api.journeySkipped')}</p>;
        }
        return (
          <div key={index} className="rounded-xl bg-surface/70 p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">{label}</p>
            {result.sent && (
              <div className="mb-2">
                <p className="font-mono text-[11px] text-ink">{result.sent.method} {result.sent.url}</p>
                {result.sent.headers.length > 0 && (
                  <pre className="app-scroller sb-hairline mt-1 max-h-32 overflow-auto rounded-lg bg-panel px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted">
                    {result.sent.headers.map(([key, value]) => `${key}: ${value}`).join('\n')}
                  </pre>
                )}
                {result.sent.body && (
                  <pre className="app-scroller sb-hairline mt-1 max-h-44 overflow-auto rounded-lg bg-panel px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted">
                    {result.sent.body}
                  </pre>
                )}
              </div>
            )}
            {result.response && (
              <>
                <p className="text-[11px] text-muted">
                  {t('api.journeyDetailStatus')}: <span className={`font-semibold ${result.response.ok ? 'text-success' : 'text-danger'}`}>{result.response.status} {result.response.statusText}</span> · {result.response.ms.toFixed(0)} ms
                </p>
                <pre className="app-scroller sb-hairline mt-1 max-h-60 overflow-auto rounded-lg bg-panel px-2.5 py-2 font-mono text-[10px] leading-relaxed text-ink">
                  {previewBody(result.response.body)}
                </pre>
              </>
            )}
            {result.error && <p className="mt-1.5 text-[11px] text-danger">{result.error}</p>}
          </div>
        );
      })}
    </div>
  );
}

function moveStep(steps: JourneyNode[], index: number, direction: -1 | 1): JourneyNode[] {
  const target = index + direction;
  if (target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  const [step] = next.splice(index, 1);
  if (!step) return steps;
  next.splice(target, 0, step);
  return next;
}