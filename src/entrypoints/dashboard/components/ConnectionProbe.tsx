import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Globe,
  Loader2,
  Radio,
  ShieldOff,
  Zap,
} from 'lucide-react';
import type { ProbeResult } from '@/engine/runner';

interface ConnectionProbeProps {
  /** The probe runs against the current Request + Variable form values.
   *  The parent owns the config and the "ready" state — we only fire when
   *  asked. */
  run: () => Promise<ProbeResult>;
  disabled?: boolean;
}

type Status = 'idle' | 'running' | 'done';

/**
 * "Test Connection" affordance for the Request panel.
 *
 * Fires a single fetch with the current URL / headers / body / timeout and
 * surfaces the outcome as a coloured card:
 *
 *   success (2xx/3xx)  -> green  + status badge + latency + bytes + finalUrl
 *   http   (4xx/5xx)   -> yellow + status badge + "non-2xx" hint
 *   timeout            -> orange + retry hint
 *   network/dns/cors   -> red    + diagnostic + copy-to-clipboard
 *
 * The card collapses the verbose error message by default but keeps the
 * exact wording one click away — copy lets users paste it into chat / issue
 * trackers without having to retype.
 */
export function ConnectionProbe({ run, disabled }: ConnectionProbeProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const fire = async () => {
    setStatus('running');
    setResult(null);
    setExpanded(false);
    try {
      const r = await run();
      setResult(r);
      setStatus('done');
    } catch (e) {
      // A config-level error (no URL, invalid headers, …). Wrap as a
      // synthetic ProbeResult so the UI can render the same card shape.
      setResult({
        ok: false,
        status: 0,
        ms: 0,
        bytes: 0,
        error: e instanceof Error ? e.message : String(e),
        errorKind: 'network',
        finalUrl: '',
      });
      setStatus('done');
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      <button
        type="button"
        onClick={fire}
        disabled={disabled || status === 'running'}
        className="ghost-btn flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'running' ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Radio size={13} />
        )}
        {status === 'running' ? t('probe.testing') : t('probe.test')}
      </button>

      {status === 'done' && result && (
        <ProbeCard result={result} expanded={expanded} setExpanded={setExpanded} copied={copied} setCopied={setCopied} t={t} />
      )}
    </div>
  );
}

function ProbeCard({
  result,
  expanded,
  setExpanded,
  copied,
  setCopied,
  t,
}: {
  result: ProbeResult;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  copied: boolean;
  setCopied: (v: boolean) => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const success = result.ok;
  // 4xx / 5xx count as "reachable but unhappy" — a yellow card rather than
  // a green success card. The distinction matters for the user: a green
  // card means the URL + headers + body all worked; yellow means the URL
  // is right but the server replied with an error.
  const isHttpFail = !result.errorKind && result.status >= 400;
  const tone = success ? 'ok' : isHttpFail ? 'warn' : 'fail';

  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === 'ok'
          ? 'border-success/30 bg-success/5'
          : tone === 'warn'
            ? 'border-warning/30 bg-warning/5'
            : 'border-danger/30 bg-danger/5'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {tone === 'ok' ? (
            <CheckCircle2 size={15} className="mt-0.5 text-success" />
          ) : tone === 'warn' ? (
            <AlertTriangle size={15} className="mt-0.5 text-warning" />
          ) : (
            <ShieldOff size={15} className="mt-0.5 text-danger" />
          )}
          <div className="min-w-0">
            <div className="text-[12px] font-semibold">
              {tone === 'ok'
                ? t('probe.reachable')
                : tone === 'warn'
                  ? t('probe.reachableWithStatus', { status: result.status })
                  : t('probe.unreachable', { kind: kindLabel(result.errorKind, t) })}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted">
              {result.status > 0 && <Badge tone={tone}>{result.status}</Badge>}
              <Stat icon={<Clock size={11} />} label={t('probe.latency')} value={`${result.ms.toFixed(0)} ms`} />
              {result.bytes > 0 && (
                <Stat icon={<Zap size={11} />} label={t('probe.size')} value={formatBytes(result.bytes)} />
              )}
              {result.finalUrl && result.finalUrl && (
                <Stat
                  icon={<Globe size={11} />}
                  label={t('probe.finalUrl')}
                  value={result.finalUrl.replace(/^https?:\/\//, '')}
                  truncate
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {result.error && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {t('probe.details')}
          </button>
          {expanded && (
            <div className="mt-1.5 flex items-start gap-2">
              <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-panel p-2 font-mono text-[11px] leading-relaxed text-ink">
                {result.error}
              </pre>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.error);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  } catch {
                    /* clipboard unavailable */
                  }
                }}
                className="ghost-btn flex shrink-0 items-center gap-1 px-2 py-1 text-[11px]"
              >
                {copied ? <CheckCircle2 size={11} /> : <Copy size={11} />}
                {copied ? t('probe.copied') : t('probe.copy')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'fail'; children: React.ReactNode }) {
  const cls =
    tone === 'ok'
      ? 'bg-success/15 text-success'
      : tone === 'warn'
        ? 'bg-warning/15 text-warning'
        : 'bg-danger/15 text-danger';
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{children}</span>;
}

function Stat({
  icon,
  label,
  value,
  truncate,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  truncate?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="opacity-60">{icon}</span>
      <span className="opacity-60">{label}</span>
      <span className={truncate ? 'max-w-[160px] truncate text-ink' : 'text-ink'} title={truncate ? value : undefined}>
        {value}
      </span>
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function kindLabel(kind: ProbeResult['errorKind'], t: (k: string) => string): string {
  switch (kind) {
    case 'timeout':
      return t('probe.kindTimeout');
    case 'dns':
      return t('probe.kindDns');
    case 'cors':
      return t('probe.kindCors');
    case 'aborted':
      return t('probe.kindAborted');
    case 'network':
    default:
      return t('probe.kindNetwork');
  }
}
