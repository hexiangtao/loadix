import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, StopCircle, Activity } from 'lucide-react';
import type { EngineState, MetricsSnapshot } from '@/shared/types';

interface VerdictCardProps {
  engineState: EngineState;
  metrics: MetricsSnapshot | null;
  resultMessage?: string;
  /** Optional auto-stop hint from the engine ("auto-stop: p95" / "auto-stop: errorRate"). */
  autoStopHint?: string;
}

/**
 * The one-line conclusion at the top of the results panel. Shown only when
 * a run has produced data (running / finished / aborted), so the user always
 * sees a clear "what happened" without scanning charts.
 *
 * Three visual states:
 *  - running         : blue, "in progress" pill + running metrics
 *  - finished green  : all hero thresholds met
 *  - finished yellow : some thresholds breached OR auto-stopped
 *  - aborted         : grey "stopped by user"
 */
export function VerdictCard({ engineState, metrics, resultMessage, autoStopHint }: VerdictCardProps) {
  const { t } = useTranslation();
  if (!metrics || metrics.requests === 0) return null;

  // Only show the verdict pill when a run has actually produced some output.
  const idle = engineState === 'idle' || engineState === 'finished' || engineState === 'aborted'
    ? metrics.requests === 0
    : false;
  if (idle) return null;

  const isRunning = engineState === 'running';
  const isAborted = engineState === 'aborted';
  const autoReason = autoStopHint?.startsWith('auto-stop:')
    ? autoStopHint.slice('auto-stop:'.length).trim()
    : null;

  const hasFailures =
    (metrics.errors ?? 0) > 0 ||
    Object.keys(metrics.assertionFailures ?? {}).length > 0 ||
    metrics.successRate < 100;

  let variant: 'running' | 'pass' | 'fail' | 'aborted' = 'pass';
  if (isRunning) variant = 'running';
  else if (isAborted) variant = 'aborted';
  else if (hasFailures || autoReason) variant = 'fail';

  const style = {
    running: 'border-primary/30 bg-primary/5 text-primary',
    pass: 'border-success/30 bg-success/5 text-success',
    fail: 'border-warning/30 bg-warning/10 text-warning',
    aborted: 'border-line bg-panel text-muted',
  }[variant];

  const Icon = {
    running: Activity,
    pass: CheckCircle2,
    fail: AlertCircle,
    aborted: StopCircle,
  }[variant];

  const headline = (() => {
    if (variant === 'running') return t('results.running');
    if (variant === 'aborted') return t('results.verdict.aborted');
    if (autoReason) {
      return t('results.verdict.autoStopped', {
        reason: t(`results.verdict.reason_${autoReason}`),
      });
    }
    return variant === 'pass' ? t('results.verdict.pass') : t('results.verdict.fail');
  })();

  const seconds = metrics.requests > 0 ? Math.max(1, Math.round((metrics.requests / Math.max(0.1, metrics.rps)))) : 0;
  const trailing = isRunning
    ? resultMessage || t('results.waiting')
    : variant === 'aborted'
      ? `${metrics.requests} ${t('results.requests')}`
      : t('results.verdict.completed', { seconds });

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${style}`}>
      <Icon size={18} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{headline}</div>
        <div className="truncate text-[11px] opacity-80">{trailing}</div>
      </div>
      {variant === 'fail' && metrics.errors > 0 && (
        <div className="shrink-0 rounded-md bg-danger/15 px-2 py-1 text-[11px] font-bold text-danger tabular-nums">
          ✗ {metrics.errors}
        </div>
      )}
    </div>
  );
}
