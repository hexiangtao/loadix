/**
 * Response view — the bottom pane of the Requests module.
 *
 * Meta bar: color-coded status pill, latency, size, and the resolved URL.
 * Body views: Pretty (collapsible JSON tree), Raw, Headers. The two
 * actions on the right — Copy as cURL and the load-test bridge — are the
 * whole "iteration loop": debug here, then stress the same request.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Gauge, Inbox, Zap } from 'lucide-react';
import { toCurl } from '@/shared/curl';
import type { RawResponse } from '@/engine/runner';
import type { ApiRequest } from './apiTypes';
import { buildRawRequest } from './requestRunner';
import { JsonTree } from './jsonTree';

interface ResponseViewProps {
  response: RawResponse | null;
  sending: boolean;
  request: ApiRequest;
  vars: [string, string][];
  onLoadTest: (request: ApiRequest) => void;
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

export function ResponseView({ response, sending, request, vars, onLoadTest }: ResponseViewProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('pretty');
  const [copied, setCopied] = useState<'curl' | 'body' | null>(null);

  const raw = useMemo(() => buildRawRequest(request, Object.fromEntries(vars)), [request, vars]);

  const prettyJson = useMemo(() => {
    if (!response || !response.body.trim()) return null;
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      return undefined; // not JSON — show raw
    }
  }, [response]);

  const flash = (kind: 'curl' | 'body') => {
    setCopied(kind);
    setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1200);
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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-panel">
        <div className="flex size-11 items-center justify-center rounded-2xl border border-line bg-surface">
          <Zap size={18} className="text-muted/40" />
        </div>
        <p className="text-[13px] font-medium text-muted">{t('api.emptyResponse')}</p>
        <p className="text-[11px] text-muted/70">{t('api.emptyResponseHint')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-panel">
      {/* Meta bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {sending && !response ? (
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className="size-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              {t('api.sending')}…
            </span>
          ) : (
            <>
              <span className={`anim-pop shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${response ? STATUS_COLOR(response.status) : ''}`}>
                {response && response.status > 0
                  ? `${response.status} ${response.statusText}`
                  : response?.errorKind === 'aborted'
                    ? t('probe.kindAborted')
                    : t('api.error')}
              </span>
              {response && (
                <>
                  <span className={`text-[11px] font-semibold tabular-nums ${MS_COLOR(response.ms)}`}>{response.ms.toFixed(0)} ms</span>
                  <span className="text-[11px] text-muted">· {formatBytes(response.bytes)}</span>
                  {response.finalUrl !== raw.url && (
                    <span className="min-w-0 truncate text-[11px] text-muted" title={response.finalUrl}>
                      → {response.finalUrl}
                    </span>
                  )}
                  {response.error && <span className="truncate text-[11px] text-danger" title={response.error}>{response.error}</span>}
                </>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {response && (
            <div className="flex items-center gap-0.5 rounded-lg border border-line bg-hover p-0.5">
              {(['pretty', 'raw', 'headers'] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`cursor-pointer rounded-md px-2 py-0.5 text-[11px] transition-colors duration-150 ${
                    view === v ? 'bg-panel font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                >
                  {t(`api.view_${v}`)}
                </button>
              ))}
            </div>
          )}
          {response && (
            <button onClick={copyCurl} title={t('api.copyCurl')} className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-hover hover:text-ink">
              {copied === 'curl' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
              {copied === 'curl' ? t('api.copied') : t('api.copyCurl')}
            </button>
          )}
          {response && (
            <button onClick={copyBody} title={t('api.copyBody')} className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-hover hover:text-ink">
              {copied === 'body' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
              {copied === 'body' ? t('api.copied') : t('api.copyBody')}
            </button>
          )}
          <button
            onClick={() => onLoadTest(request)}
            title={t('api.loadTestThis')}
            className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-primary transition-colors duration-150 hover:bg-primary/10"
          >
            <Gauge size={12} />
            {t('api.loadTestThis')}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="app-scroller sb-hairline anim-fade min-h-0 flex-1 overflow-auto px-3 py-2">
        {view === 'headers' && response && (
          <table className="w-full text-left text-[12px]">
            <tbody>
              {response.headers.length === 0 && (
                <tr>
                  <td className="py-1 text-muted">{t('api.noHeaders')}</td>
                </tr>
              )}
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
            {prettyJson !== null && prettyJson !== undefined && view === 'pretty' ? (
              <JsonTree data={prettyJson} />
            ) : (
              <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-ink/90">
                {response.body || t('api.emptyBody')}
                {prettyJson === undefined && view === 'pretty' && response.body.trim() && (
                  <span className="mt-1 block text-[11px] text-muted">{t('api.notJson')}</span>
                )}
              </pre>
            )}
          </>
        )}
        {!response && sending && <p className="py-4 text-center text-[12px] text-muted">{t('api.sending')}…</p>}
        {errorKindKey && response?.status === 0 && (
          <p className="mt-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-[12px] text-danger">
            {t(`probe.${errorKindKey}`)}
            {response?.errorKind === 'cors' && <span className="mt-0.5 block text-[11px] opacity-80">{t('api.corsHint')}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}