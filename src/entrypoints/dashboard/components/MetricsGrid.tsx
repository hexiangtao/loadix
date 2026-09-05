import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { MetricsSnapshot } from '@/shared/types';

interface MetricsGridProps {
  metrics: MetricsSnapshot | null;
  compact?: boolean;
}

/**
 * The "summary" row + a collapsible "details" row of secondary metrics.
 * The three hero KPIs (RPS / P95 / error rate) live in <HeroMetrics/> above
 * this component; what remains here is the supporting cast: counts, averages,
 * the long tail of percentiles.
 */
export function MetricsGrid({ metrics }: MetricsGridProps) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);

  const summary: [string, string][] = [
    [t('results.requests'), String(metrics?.requests ?? 0)],
    [t('results.success'), String(metrics?.success ?? 0)],
    [t('results.errors'), String(metrics?.errors ?? 0)],
    [t('results.avg'), `${(metrics?.avg ?? 0).toFixed(0)} ms`],
    [t('results.max'), `${(metrics?.max ?? 0).toFixed(0)} ms`],
  ];

  const details: [string, string][] = [
    [t('results.p50'), `${(metrics?.p50 ?? 0).toFixed(0)} ms`],
    [t('results.p90'), `${(metrics?.p90 ?? 0).toFixed(0)} ms`],
    [t('results.p95'), `${(metrics?.p95 ?? 0).toFixed(0)} ms`],
    [t('results.p99'), `${(metrics?.p99 ?? 0).toFixed(0)} ms`],
    [t('results.successRate'), `${(metrics?.successRate ?? 0).toFixed(1)}%`],
    [t('results.rps'), `${(metrics?.rps ?? 0).toFixed(1)} /s`],
  ];

  const cellCls = 'rounded-lg border border-line bg-panel px-3 py-2';
  const labelCls = 'mb-0.5 block text-[10px] uppercase tracking-wide text-muted';
  const valueCls = 'text-[15px] font-bold tabular-nums';

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {summary.map(([label, value]) => (
          <div className={cellCls} key={label}>
            <span className={labelCls}>{label}</span>
            <b className={valueCls}>{value}</b>
          </div>
        ))}
      </div>

      <button
        onClick={() => setShowDetails((v) => !v)}
        className="flex items-center gap-1 self-start rounded-md px-2 py-1 text-[11px] font-semibold text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
      >
        <ChevronDown size={12} className={`transition-transform duration-150 ${showDetails ? 'rotate-180' : ''}`} />
        {t('results.summary.details')}
      </button>

      {showDetails && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {details.map(([label, value]) => (
            <div className={cellCls} key={label}>
              <span className={labelCls}>{label}</span>
              <b className={valueCls}>{value}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
