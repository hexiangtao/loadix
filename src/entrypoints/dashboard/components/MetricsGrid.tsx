import { useTranslation } from 'react-i18next';
import type { MetricsSnapshot } from '@/shared/types';

interface MetricsGridProps {
  metrics: MetricsSnapshot | null;
  compact?: boolean;
}

export function MetricsGrid({ metrics, compact }: MetricsGridProps) {
  const { t } = useTranslation();
  const m = metrics;
  const cells: [string, string][] = [
    [t('results.requests'), String(m?.requests ?? 0)],
    [t('results.success'), String(m?.success ?? 0)],
    [t('results.errors'), String(m?.errors ?? 0)],
    [t('results.rps'), (m?.rps ?? 0).toFixed(1)],
    [t('results.avg'), `${(m?.avg ?? 0).toFixed(0)} ms`],
    [t('results.p95'), `${(m?.p95 ?? 0).toFixed(0)} ms`],
    [t('results.p99'), `${(m?.p99 ?? 0).toFixed(0)} ms`],
    [t('results.successRate'), `${(m?.successRate ?? 0).toFixed(1)}%`],
  ];
  return (
    <div className={compact ? 'grid grid-cols-2 gap-2' : 'mb-4 grid grid-cols-8 gap-2.5 max-xl:grid-cols-4'}>
      {cells.map(([label, value]) => (
        <div className="rounded-lg border border-line bg-panel p-3" key={label}>
          <span className="mb-1 block text-[11px] text-muted">{label}</span>
          <b className={compact ? 'text-[15px]' : 'text-[17px]'}>{value}</b>
        </div>
      ))}
    </div>
  );
}
