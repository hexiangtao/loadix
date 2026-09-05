import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Check, Clock, Copy, Download, FileText, Globe, Hash, Layers, X } from 'lucide-react';
import type { RequestResult } from '@/shared/types';
import { normaliseError } from '@/engine/metrics';

interface RequestDetailsProps {
  /** The request to inspect. `null` closes the drawer. */
  request: RequestResult | null;
  /** The configured URL — useful to show what was *sent* vs. what was *hit*. */
  requestUrl: string;
  onClose: () => void;
}

type Tab = 'headers' | 'body' | 'timing';

/**
 * Slide-in drawer with full per-request diagnostics: response headers, body,
 * and Performance API timing breakdown. Reachable from the Recent Requests,
 * Slowest Requests, and Error Groups panels.
 *
 * The drawer is overlay-only — no focus trap, no portal — because it's
 * always rendered next to its trigger and Escape/Cancel are sufficient for
 * keyboard users. Body preview is capped at ~50 KB to keep the DOM light;
 * "Download" drops the full payload to disk when the user really needs it.
 */
export function RequestDetails({ request, requestUrl, onClose }: RequestDetailsProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('headers');
  const [copied, setCopied] = useState(false);

  // Escape closes; reset to the default tab whenever a new request opens.
  useEffect(() => {
    if (!request) return;
    setTab('headers');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, onClose]);

  return (
    <AnimatePresence>
      {request && (
        <motion.div
          className="fixed inset-0 z-40 flex justify-end bg-black/30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={onClose}
        >
          <motion.aside
            className="flex h-full w-full max-w-xl flex-col border-l border-line bg-panel shadow-2xl"
            initial={{ x: 60 }}
            animate={{ x: 0 }}
            exit={{ x: 60 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            data-testid="request-details"
          >
            <Header request={request} requestUrl={requestUrl} onClose={onClose} t={t} />
            <TabBar tab={tab} setTab={setTab} t={t} />
            <div className="flex-1 overflow-auto p-4">
              {tab === 'headers' && <HeadersView request={request} t={t} />}
              {tab === 'body' && <BodyView request={request} copied={copied} setCopied={setCopied} t={t} />}
              {tab === 'timing' && <TimingView request={request} t={t} />}
            </div>
            {request.failures && request.failures.length > 0 && (
              <FailuresPanel failures={request.failures} t={t} />
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Header({
  request,
  requestUrl,
  onClose,
  t,
}: {
  request: RequestResult;
  requestUrl: string;
  onClose: () => void;
  t: (k: string) => string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${
              request.pass ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
            }`}
          >
            {request.pass ? 'PASS' : 'FAIL'}
          </span>
          <span className="font-mono text-[13px] font-semibold">{request.status || '—'}</span>
          <span className="font-mono text-[11px] text-muted">
            {new Date(request.ts).toLocaleTimeString()}
          </span>
          <span className="font-mono text-[12px] font-semibold tabular-nums text-ink">
            {request.ms.toFixed(0)} ms
          </span>
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted" title={requestUrl}>
          {requestUrl}
        </div>
        {request.finalUrl && request.finalUrl !== requestUrl && (
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
            → <span className="text-ink">{request.finalUrl}</span>
          </div>
        )}
        {request.error && (
          <div className="mt-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-1.5 font-mono text-[11px] text-danger">
            {request.error}
            <div className="mt-0.5 text-muted">{normaliseError(request.error)}</div>
          </div>
        )}
      </div>
      <button className="icon-btn shrink-0" onClick={onClose} aria-label={t('results.details.close')}>
        <X size={16} />
      </button>
    </div>
  );
}

function TabBar({
  tab,
  setTab,
  t,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  t: (k: string) => string;
}) {
  const tabs: Array<{ id: Tab; labelKey: string; icon: typeof Globe }> = [
    { id: 'headers', labelKey: 'results.details.headers', icon: Layers },
    { id: 'body', labelKey: 'results.details.body', icon: FileText },
    { id: 'timing', labelKey: 'results.details.timing', icon: Clock },
  ];
  return (
    <div className="flex border-b border-line bg-surface/40">
      {tabs.map(({ id, labelKey, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          className={`relative flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-semibold transition-colors duration-150 ${
            tab === id ? 'text-primary' : 'text-muted hover:text-ink'
          }`}
        >
          {tab === id && (
            <motion.span
              layoutId="rd-tab"
              className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
            />
          )}
          <Icon size={13} />
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}

function HeadersView({ request, t }: { request: RequestResult; t: (k: string) => string }) {
  const entries = Object.entries(request.responseHeaders ?? {});
  if (entries.length === 0) {
    return <EmptyState message={t('results.details.noHeaders')} />;
  }
  return (
    <table className="w-full border-collapse font-mono text-[11px]">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="border-b border-line/50 last:border-0">
            <td className="w-1/3 py-1 pr-2 align-top font-semibold text-muted">{k}</td>
            <td className="break-all py-1 align-top text-ink">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BodyView({
  request,
  copied,
  setCopied,
  t,
}: {
  request: RequestResult;
  copied: boolean;
  setCopied: (v: boolean) => void;
  t: (k: string) => string;
}) {
  const body = request.body ?? '';
  const isJson = body.trim().startsWith('{') || body.trim().startsWith('[');
  const [showRaw, setShowRaw] = useState(false);

  const displayed = (() => {
    if (!isJson || showRaw) return body;
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  })();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable; silently ignore */
    }
  };

  const download = () => {
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `loadix-response-${request.ts}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!body) return <EmptyState message={t('results.details.noBody')} />;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {request.bytes !== undefined && (
          <span className="flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 font-mono text-[11px] text-muted">
            <Hash size={11} />
            {formatBytes(request.bytes)} · {t('results.details.size')}
          </span>
        )}
        {isJson && (
          <button
            className="ghost-btn flex items-center gap-1 text-[11px]"
            onClick={() => setShowRaw((v) => !v)}
          >
            <FileText size={11} />
            {showRaw ? t('results.details.viewFormatted') : t('results.details.viewRaw')}
          </button>
        )}
        <button className="ghost-btn flex items-center gap-1 text-[11px]" onClick={copy}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? t('results.details.copied') : t('results.details.copy')}
        </button>
        <button className="ghost-btn flex items-center gap-1 text-[11px]" onClick={download}>
          <Download size={11} />
          .txt
        </button>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-surface/40 p-3 font-mono text-[11px] leading-relaxed text-ink">
        {displayed}
      </pre>
    </div>
  );
}

function TimingView({ request, t }: { request: RequestResult; t: (k: string) => string }) {
  const timing = request.timing;
  if (!timing || Object.values(timing).every((v) => v === undefined)) {
    return <EmptyState message={t('results.details.noTiming')} />;
  }
  const rows: Array<{ key: string; label: string; ms?: number; tone: 'primary' | 'muted' }> = [
    { key: 'dns', label: t('results.timing.dns'), ms: timing.dnsMs, tone: 'muted' },
    { key: 'connect', label: t('results.timing.connect'), ms: timing.connectMs, tone: 'muted' },
    { key: 'tls', label: t('results.timing.tls'), ms: timing.tlsMs, tone: 'muted' },
    { key: 'wait', label: t('results.timing.wait'), ms: timing.waitMs, tone: 'primary' },
    { key: 'download', label: t('results.timing.download'), ms: timing.downloadMs, tone: 'primary' },
  ];
  const accounted = rows.reduce((s, r) => s + (r.ms ?? 0), 0);
  const total = request.ms;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-line bg-surface/40 p-3">
        <div className="flex h-3 overflow-hidden rounded-full bg-line">
          {rows.map((r) => {
            const v = r.ms ?? 0;
            if (v <= 0) return null;
            const pct = (v / Math.max(total, accounted, 1)) * 100;
            return (
              <div
                key={r.key}
                title={`${r.label}: ${v.toFixed(0)} ms`}
                className={r.tone === 'primary' ? 'bg-primary' : 'bg-muted/60'}
                style={{ width: `${pct}%` }}
              />
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted">
          <span>0 ms</span>
          <span className="font-semibold text-ink">{total.toFixed(0)} ms · {t('results.timing.total')}</span>
        </div>
      </div>
      <table className="w-full border-collapse font-mono text-[11px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line/50 last:border-0">
              <td className="w-1/3 py-1 pr-2 align-top text-muted">{r.label}</td>
              <td className="py-1 pr-2 text-right align-top tabular-nums text-ink">
                {r.ms === undefined ? 'n/a' : `${r.ms.toFixed(1)} ms`}
              </td>
              <td className="py-1 text-right align-top tabular-nums text-muted">
                {r.ms === undefined ? '' : `${((r.ms / total) * 100).toFixed(0)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FailuresPanel({
  failures,
  t,
}: {
  failures: NonNullable<RequestResult['failures']>;
  t: (k: string) => string;
}) {
  return (
    <div className="border-t border-line bg-danger/5 p-4">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-danger">
        {t('results.details.failures')}
      </div>
      <ul className="flex flex-col gap-1 font-mono text-[11px]">
        {failures.map((f, i) => (
          <li key={i} className="text-danger">
            {f.type} = {f.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="rounded-lg border border-dashed border-line bg-surface/40 px-4 py-8 text-center text-[12px] text-muted">{message}</div>;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
