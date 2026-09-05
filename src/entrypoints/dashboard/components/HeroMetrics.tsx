import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import type { MetricsSnapshot, TestConfig } from '@/shared/types';

interface HeroMetricsProps {
  metrics: MetricsSnapshot | null;
  /** Current load configuration, used to know the RPS target / thresholds. */
  target?: Pick<TestConfig, 'rps' | 'maxErrorRate' | 'maxP95'>;
}

/**
 * The three KPIs that decide pass/fail, with target/threshold comparison
 * baked in. Rendered large so they're readable from arm's length — these are
 * the numbers users want to glance at while a run is in progress.
 *
 *  - RPS   vs `target.rps`           (lower is OK only when target = 0)
 *  - P95   vs `target.maxP95`        (lower is better)
 *  - Error vs `target.maxErrorRate`  (lower is better)
 *
 * A value without a target/threshold shows a neutral grey dot.
 */
export function HeroMetrics({ metrics, target }: HeroMetricsProps) {
  const { t } = useTranslation();
  const rps = metrics?.rps ?? 0;
  const p95 = metrics?.p95 ?? 0;
  const errorRate = 100 - (metrics?.successRate ?? 0);

  // "Met" means: a target/threshold is set AND we are within it.
  // For RPS we only check when target > 0 (no target = "as fast as possible").
  const rpsMet = !target?.rps || rps >= (target.rps ?? 0) * 0.95;
  const p95Met = !target?.maxP95 || p95 <= (target.maxP95 ?? 0);
  const errMet = !target?.maxErrorRate || errorRate <= (target.maxErrorRate ?? 0);

  const cells: Array<{
    label: string;
    value: string;
    sub?: string;
    met: boolean;
    hasTarget: boolean;
  }> = [
    {
      label: t('results.rps'),
      value: rps.toFixed(1),
      sub: target?.rps ? t('results.verdict.vsTarget', { target: target.rps.toFixed(1) }) : undefined,
      met: rpsMet,
      hasTarget: !!target?.rps,
    },
    {
      label: t('results.p95'),
      value: `${p95.toFixed(0)} ms`,
      sub: target?.maxP95 ? t('results.verdict.vsMax', { max: target.maxP95 }) : undefined,
      met: p95Met,
      hasTarget: !!target?.maxP95,
    },
    {
      label: t('results.successRate'),
      value: `${(metrics?.successRate ?? 0).toFixed(1)}%`,
      sub: target?.maxErrorRate ? t('results.verdict.vsMax', { max: `${target.maxErrorRate}%` }) : undefined,
      met: errMet,
      hasTarget: !!target?.maxErrorRate,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      {cells.map((c) => (
        <div
          key={c.label}
          className={`relative overflow-hidden rounded-xl border bg-panel p-4 transition-colors duration-150 ${
            c.hasTarget
              ? c.met
                ? 'border-success/30 bg-success/5'
                : 'border-danger/30 bg-danger/5'
              : 'border-line'
          }`}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{c.label}</span>
            {c.hasTarget &&
              (c.met ? (
                <Check size={14} className="text-success" />
              ) : (
                <X size={14} className="text-danger" />
              ))}
          </div>
          <div className={`text-[26px] font-bold leading-tight tabular-nums ${c.hasTarget && !c.met ? 'text-danger' : 'text-ink'}`}>
            {c.value}
          </div>
          {c.sub && <div className="mt-0.5 text-[11px] text-muted">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
