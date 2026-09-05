import { useTranslation } from 'react-i18next';
import type { MetricsSnapshot, RequestResult } from '@/shared/types';

interface RecentRequestsProps {
  metrics: MetricsSnapshot | null;
  onSelect: (request: RequestResult) => void;
}

export function RecentRequests({ metrics, onSelect }: RecentRequestsProps) {
  const { t } = useTranslation();
  const recent = metrics?.recent ?? [];
  return (
    <div className="flex max-h-60 min-h-30 flex-col overflow-auto">
      {recent.length === 0 && <div className="text-xs text-muted">{t('results.waiting')}</div>}
      {recent.map((r, i) => (
        <button
          key={`${r.ts}-${i}`}
          onClick={() => onSelect(r)}
          className="grid w-full grid-cols-[90px_60px_1fr_80px] gap-2 border-b border-line py-1.5 text-left text-xs transition-colors duration-150 hover:bg-hover"
        >
          <span>{new Date(r.ts).toLocaleTimeString()}</span>
          <span className={r.pass ? 'font-bold text-success' : 'font-bold text-danger'}>{r.pass ? 'PASS' : 'FAIL'}</span>
          <span>{r.status || r.error}</span>
          <span className="text-right tabular-nums">{r.ms.toFixed(0)} ms</span>
        </button>
      ))}
    </div>
  );
}
