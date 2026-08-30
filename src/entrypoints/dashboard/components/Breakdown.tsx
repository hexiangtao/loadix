import { useTranslation } from 'react-i18next';
import type { MetricsSnapshot } from '@/shared/types';

interface BreakdownProps {
  metrics: MetricsSnapshot | null;
}

export function Breakdown({ metrics }: BreakdownProps) {
  const { t } = useTranslation();
  const entries = Object.entries(metrics?.statusBreakdown ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="flex min-h-30 flex-col gap-2">
      {entries.length === 0 && <div className="text-xs text-muted">{t('results.waiting')}</div>}
      {entries.map(([key, count]) => (
        <div className="grid grid-cols-[110px_1fr_50px] items-center gap-2.5 text-xs" key={key}>
          <span>{key}</span>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <i className="block h-full rounded-full bg-primary" style={{ width: `${(count / max) * 100}%` }} />
          </div>
          <b>{count}</b>
        </div>
      ))}
    </div>
  );
}
