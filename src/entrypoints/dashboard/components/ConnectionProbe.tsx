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
  X,
  Zap,
} from 'lucide-react';
import type { ProbeResult } from '@/engine/runner';

interface ConnectionProbeProps {
  /** The probe runs against the current Request + Variable form values.
   *  The parent owns the config and the "ready" state — we only fire when
   *  asked. */
  run: () => Promise<ProbeResult>;
  disabled?: boolean;
  /** Called whenever the probe state changes. The parent decides *where*
   *  to render <ProbeCard /> (typically at panel width, not within a
   *  half-width grid cell), so that the card never gets squeezed into a
   *  vertical stat column. */
  onResult?: (state: { status: 'idle' | 'running' | 'done'; result: ProbeResult | null }) => void;
}

type Status = 'idle' | 'running' | 'done';

/**
 * "Test Connection" affordance for the Request panel.
 *
 * Fires a single fetch with the current URL / headers / body / timeout and
 * surfaces the outcome via `onResult`. The card itself is **not** rendered
 * here — it lives in the parent (RequestPanel) at panel width, so it never
 * inherits the half-width of the trigger button row.
 */
export function ConnectionProbe({ run, disabled, onResult }: ConnectionProbeProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<ProbeResult | null>(null);

  const emit = (next: { status: Status; result: ProbeResult | null }) => {
    setStatus(next.status);
    setResult(next.result);
    onResult?.(next);
  };

  const fire = async () => {
    emit({ status: 'running', result: null });
    try {
      const r = await run();
      emit({ status: 'done', result: r });
    } catch (e) {
      // A config-level error (no URL, invalid headers, …). Wrap as a
      // synthetic ProbeResult so the UI can render the same card shape.
      emit({
        status: 'done',
        result: {
          ok: false,
          status: 0,
          ms: 0,
          bytes: 0,
          error: e instanceof Error ? e.message : String(e),
          errorKind: 'network',
          finalUrl: '',
        },
      });
    }
  };

  return (
    <button
      type="button"
      onClick={fire}
      disabled={disabled || status === 'running'}
      className="ghost-btn inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
    >
      {status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />}
      {status === 'running' ? t('probe.testing') : t('probe.test')}
    </button>
  );
}

interface ProbeCardProps {
  result: ProbeResult;
  /** Hide the card and clear any expanded details. Wired to the parent so
   *  dismissing the card doesn't leave the next probe's state in a
   *  half-collapsed shape. */
  onDismiss?: () => void;
}

/**
 * Probe result card — rendered by the parent at panel width.
 *
 *   success (2xx/3xx)  -> green  + status badge + latency + bytes + finalUrl
 *   http   (4xx/5xx)   -> yellow + status badge + "non-2xx" hint
 *   timeout            -> orange + retry hint
 *   network/dns/cors   -> red    + diagnostic + copy-to-clipboard
 */
export function ProbeCard({ result, onDismiss }: ProbeCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  // 4xx / 5xx count as "reachable but unhappy" — a yellow card rather than
  // a green success card. The distinction matters for the user: a green
  // card means the URL + headers + body all worked; yellow means the URL
  // is right but the server replied with an error.
  const isHttpFail = !result.errorKind && result.status >= 400;
  const tone = result.ok ? 'ok' : isHttpFail ? 'warn' : 'fail';

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
      {/* Card header: [icon] [title + stats inline]   [details ▾] [close ×]
          The grid keeps the actions on the right edge even on narrow cards;
          the title and stats sit in a single column with wrap so long
          finalUrls break to a new line instead of squeezing the latency /
          size pair into a single-character column. */}
      <div className="grid grid-cols-[auto_1fr_auto_auto] items-start gap-2">
        <div className="pt-0.5">
          {tone === 'ok' ? (
            <CheckCircle2 size={15} className="text-success" />
          ) : tone === 'warn' ? (
            <AlertTriangle size={15} className="text-warning" />
          ) : (
            <ShieldOff size={15} className="text-danger" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold">
            {tone === 'ok'
              ? t('probe.reachable')
              : tone === 'warn'
                ? t('probe.reachableWithStatus', { status: result.status })
                : t('probe.unreachable', { kind: kindLabel(result.errorKind, t) })}
          </div>
          {/* Stats: icon + label + value, single line, wrap on overflow.
              gap-x-2 + flex-wrap keeps 3 stats + a status badge readable
              at the panel width (~260px). */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted">
            {result.status > 0 && <Badge tone={tone}>{result.status}</Badge>}
            <Stat icon={<Clock size={11} />} label={t('probe.latency')} value={`${result.ms.toFixed(0)} ms`} />
            {result.bytes > 0 && (
              <Stat icon={<Zap size={11} />} label={t('probe.size')} value={formatBytes(result.bytes)} />
            )}
            {result.finalUrl && (
              <Stat
                icon={<Globe size={11} />}
                label={t('probe.finalUrl')}
                value={result.finalUrl.replace(/^https?:\/\//, '')}
                truncate
              />
            )}
          </div>
        </div>
        {result.error && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 self-start rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
            title={t('probe.details')}
            aria-label={t('probe.details')}
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-md text-muted transition-colors hover:bg-hover hover:text-ink"
          title={t('close')}
          aria-label={t('close')}
        >
          <X size={12} />
        </button>
      </div>

      {result.error && expanded && (
        <div className="mt-2 flex items-start gap-2">
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
  // `whitespace-nowrap` keeps each stat on a single line; `min-w-0` on
  // the value cell lets the URL stat ellipsis when the card is narrow.
  return (
    <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap">
      <span className="opacity-60">{icon}</span>
      <span className="opacity-60">{label}</span>
      <span
        className={truncate ? 'min-w-0 max-w-[140px] truncate text-ink' : 'text-ink'}
        title={truncate ? value : undefined}
      >
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
