/**
 * Response view — the lower pane of the Requests module.
 *
 * The first state is a launchpad rather than an empty placeholder. Once a
 * request runs, the pane leads with a compact result summary and keeps the
 * detailed response views below it.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, FileText, Gauge, RefreshCw, Terminal, Zap } from 'lucide-react';
import { toCurl } from '@/shared/curl';
import type { RawResponse } from '@/engine/runner';
import type { ApiRequest } from './apiTypes';
import { buildRawRequest } from './requestRunner';
import { JsonTree } from './jsonTree';
import { Launchpad } from './Launchpad';
import { formatResponseAsMarkdown } from './responseToMarkdown';

interface ResponseViewProps {
  response: RawResponse | null;
  previousResponse: RawResponse | null;
  sending: boolean;
  request: ApiRequest;
  vars: [string, string][];
  onLoadTest: (request: ApiRequest) => void;
  onOpenInMarkdown: (markdown: string) => void;
  onLaunch: (patch: Partial<ApiRequest>, send: boolean) => void;
}

type View = 'pretty' | 'raw' | 'headers';

const STATUS_COLOR = (status: number): string => {
  if (status === 0) return 'bg-danger/15 text-danger';
  if (status < 300) return 'bg-success/15 text-success';
  if (status < 400) return 'bg-primary/15 text-primary';
  if (status < 500) return 'bg-warning/15 text-warning';
  return 'bg-danger/15 text-danger';
};

/** Latency reads at a glance: green fast, amber slow, red crawling. */
const MS_COLOR = (ms: number): string => (ms < 300 ? 'text-success' : ms < 1000 ? 'text-warning' : 'text-danger');

type SnapshotResponse = RawResponse & { bodyTruncated?: boolean };

export function ResponseView({ response, previousResponse, sending, request, vars, onLoadTest, onOpenInMarkdown, onLaunch }: ResponseViewProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('pretty');
  const [copied, setCopied] = useState<'curl' | 'body' | null>(null);

  const raw = useMemo(() => buildRawRequest(request, Object.fromEntries(vars)), [request, vars]);
  const markdownSnapshot = useMemo(
    () => (response ? formatResponseAsMarkdown(request, response, raw) : ''),
    [request, response, raw],
  );
  const prettyJson = useMemo(() => {
    if (!response || !response.body.trim()) return null;
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      return undefined;
    }
  }, [response]);

  const flash = (kind: 'curl' | 'body') => {
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1200);
  };

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(toCurl({ method: raw.method, url: raw.url, headers: raw.headers, body: raw.body ?? '' }));
      flash('curl');
    } catch {
      /* clipboard unavailable */
    }
  };

  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(response?.body ?? '');
      flash('body');
    } catch {
      /* clipboard unavailable */
    }
  };

  const errorKindKey =
    response?.errorKind === 'timeout'
      ? 'kindTimeout'
      : response?.errorKind === 'network'
        ? 'kindNetwork'
        : response?.errorKind === 'dns'
          ? 'kindDns'
          : response?.errorKind === 'cors'
            ? 'kindCors'
            : response?.errorKind === 'aborted'
              ? 'kindAborted'
              : '';

  if (!response && !sending) {
    return (
      <div className="flex min-h-0 flex-1 overflow-auto bg-panel">
        <Launchpad onApply={onLaunch} />
      </div>
    );
  }

  const snapshot = response as SnapshotResponse | null;
  const previous = previousResponse;
  const latencyDelta = response && previous ? response.ms - previous.ms : null;
  const topLevelCount = prettyJson && typeof prettyJson === 'object' ? Object.keys(prettyJson).length : 0;
  const insight = response
    ? prettyJson && typeof prettyJson === 'object'
      ? t('api.jsonInsight', { count: topLevelCount })
      : response.body
        ? t('api.textInsight', { bytes: formatBytes(response.bytes) })
        : t('api.emptyBody')
    : '';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-panel">
      <div className="app-scroller sb-hairline min-h-0 flex-1 overflow-auto">
        {response && (
          <section className="border-b border-line bg-surface/45 px-3 py-3">
            <div className="flex items-start gap-2.5">
              <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${response.ok ? 'bg-success/12 text-success' : 'bg-danger/10 text-danger'}`}>
                {response.ok ? <Check size={18} strokeWidth={2.5} /> : <Zap size={17} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="text-[14px] font-semibold text-ink">{t('api.resultTitle')}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_COLOR(response.status)}`}>
                    {response.status > 0 ? `${response.status} ${response.statusText}` : response.errorKind === 'aborted' ? t('probe.kindAborted') : t('api.error')}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted" title={raw.url}>{raw.method} {raw.url}</p>
              </div>
              <button onClick={() => onLaunch({}, true)} disabled={sending} title={t('api.runAgain')} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50">
                <RefreshCw size={12} />
                {t('api.runAgain')}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-panel">
              <Metric label={t('api.responseTime')} value={`${response.ms.toFixed(0)} ms`} valueClass={MS_COLOR(response.ms)} />
              <Metric label={t('api.responseSize')} value={formatBytes(response.bytes)} />
              <Metric label={t('api.responseInsight')} value={insight} title={insight} />
            </div>

            {latencyDelta !== null && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                <span className="size-1.5 rounded-full bg-primary/60" />
                {Math.abs(latencyDelta) < 5
                  ? t('api.sameAsPrevious')
                  : latencyDelta < 0
                    ? t('api.fasterThanPrevious', { delta: Math.abs(latencyDelta).toFixed(0) })
                    : t('api.slowerThanPrevious', { delta: latencyDelta.toFixed(0) })}
              </div>
            )}

            {response.error && <p className="mt-2 truncate text-[11px] text-danger" title={response.error}>{response.error}</p>}

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted/65">{t('api.nextStep')}</span>
              <button onClick={() => onLoadTest(request)} className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary/8 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15">
                <Gauge size={12} />
                {t('api.loadTestThis')}
              </button>
              <button onClick={() => onOpenInMarkdown(markdownSnapshot)} className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary/8 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15">
                <FileText size={12} />
                {t('api.openMarkdown')}
              </button>
              <button onClick={copyCurl} className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink">
                <Terminal size={12} />
                {copied === 'curl' ? t('api.copied') : t('api.copyCurl')}
              </button>
            </div>
          </section>
        )}

        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            {sending && !response ? (
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                <span className="size-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                {t('api.sending')}…
              </span>
            ) : response ? (
              <span className="text-[11px] text-muted">{t('api.responseFor')}</span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {response && (
              <div className="flex items-center gap-0.5 rounded-lg border border-line bg-hover p-0.5">
                {(['pretty', 'raw', 'headers'] as View[]).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={`cursor-pointer rounded-md px-2 py-0.5 text-[11px] transition-colors duration-150 ${view === v ? 'bg-panel font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
                    {t(`api.view_${v}`)}
                  </button>
                ))}
              </div>
            )}
            {response && (
              <button onClick={copyBody} title={t('api.copyBody')} className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-hover hover:text-ink">
                {copied === 'body' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                {copied === 'body' ? t('api.copied') : t('api.copyBody')}
              </button>
            )}
          </div>
        </div>

        <div className="px-3 py-2">
          {view === 'headers' && response && (
            <table className="w-full text-left text-[12px]">
              <tbody>
                {response.headers.length === 0 && <tr><td className="py-1 text-muted">{t('api.noHeaders')}</td></tr>}
                {response.headers.map(([key, value]) => (
                  <tr key={key} className="border-b border-line/50 last:border-0">
                    <td className="w-48 py-1 pr-3 align-top font-semibold text-primary">{key}</td>
                    <td className="break-all py-1 text-ink/80">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view !== 'headers' && response && (
            <>
              {prettyJson !== null && prettyJson !== undefined && view === 'pretty' ? <JsonTree data={prettyJson} /> : <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-ink/90">{response.body || t('api.emptyBody')}</pre>}
              {snapshot?.bodyTruncated && <p className="mt-2 text-[11px] text-muted">{t('api.responseTruncated')}</p>}
              {prettyJson === undefined && view === 'pretty' && response.body.trim() && <p className="mt-1 text-[11px] text-muted">{t('api.notJson')}</p>}
            </>
          )}
          {!response && sending && <p className="py-4 text-center text-[12px] text-muted">{t('api.sending')}…</p>}
          {errorKindKey && response?.status === 0 && <p className="mt-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-[12px] text-danger">{t(`probe.${errorKindKey}`)}{response.errorKind === 'cors' && <span className="mt-0.5 block text-[11px] opacity-80">{t('api.corsHint')}</span>}</p>}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, valueClass = 'text-ink', title }: { label: string; value: string; valueClass?: string; title?: string }) {
  return (
    <div className="min-w-0 px-2.5 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-wide text-muted/65">{label}</div>
      <div className={`mt-0.5 truncate text-[12px] font-semibold ${valueClass}`} title={title}>{value}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
