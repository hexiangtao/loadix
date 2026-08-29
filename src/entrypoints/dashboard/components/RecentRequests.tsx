import { useTranslation } from 'react-i18next';
import type { MetricsSnapshot } from '@/shared/types';

interface RecentRequestsProps {
  metrics: MetricsSnapshot | null;
}

export function RecentRequests({ metrics }: RecentRequestsProps) {
  const { t } = useTranslation();
  const recent = metrics?.recent ?? [];
  return (
    <div className="flex max-h-60 min-h-30 flex-col overflow-auto">
      {recent.length === 0 && <div className="text-xs text-muted">{t('results.waiting')}</div>}
      {recent.map((r, i) => (
        <div className="grid grid-cols-[90px_60px_1fr_80px] gap-2 border-b border-gray-100 py-1.5 text-xs" key={`${r.ts}-${i}`}>
          <span>{new Date(r.ts).toLocaleTimeString()}</span>
          <span className={r.pass ? 'font-bold text-emerald-700' : 'font-bold text-danger'}>{r.pass ? 'PASS' : 'FAIL'}</span>
          <span>{r.status || r.error}</span>
          <span>{r.ms.toFixed(0)} ms</span>
        </div>
      ))}
    </div>
  );
}
