import { useTranslation } from 'react-i18next';
import type { MetricsSnapshot } from '@/shared/types';

interface AssertionFailuresProps {
  metrics: MetricsSnapshot | null;
}

const TYPE_LABEL: Record<string, string> = {
  status: 'assertions.status',
  latency: 'assertions.latency',
  contains: 'assertions.contains',
};

/** Shows which assertions failed and how many requests tripped each, like k6 thresholds. */
export function AssertionFailures({ metrics }: AssertionFailuresProps) {
  const { t } = useTranslation();
  const entries = Object.entries(metrics?.assertionFailures ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));

  return (
    <div className="flex min-h-30 flex-col gap-2">
      {entries.length === 0 && <div className="text-xs text-muted">{t('results.waiting')}</div>}
      {entries.map(([key, count]) => {
        const [type = 'status', value = ''] = key.split(':');
        const label = t(TYPE_LABEL[type] ?? type);
        return (
          <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs" key={key}>
            <div>
              <span className="font-medium text-danger">{label}</span>
              <span className="ml-1.5 text-muted">= {value}</span>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                <i className="block h-full rounded-full bg-danger" style={{ width: `${(count / max) * 100}%` }} />
              </div>
            </div>
            <b className="tabular-nums text-danger">{count}</b>
          </div>
        );
      })}
    </div>
  );
}
