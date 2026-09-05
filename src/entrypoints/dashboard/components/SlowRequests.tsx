import { useTranslation } from 'react-i18next';
import type { MetricsSnapshot, RequestResult } from '@/shared/types';

interface SlowRequestsProps {
  metrics: MetricsSnapshot | null;
  onSelect: (request: RequestResult) => void;
}

/** Top-N slowest requests, mirroring k6 Cloud's "slowest requests" panel.
 *  Each row is clickable to open the detail drawer. */
export function SlowRequests({ metrics, onSelect }: SlowRequestsProps) {
  const { t } = useTranslation();
  const slowest = metrics?.slowest ?? [];
  return (
    // No `overflow-auto` / `max-h` — the parent <aside> in App.tsx owns
    // vertical scrolling at xl+. Keeping the list height unbounded lets
    // rows render fully and avoids the "scrollbar inside every panel" bug.
    <div className="flex flex-col">
      {slowest.length === 0 && <div className="text-xs text-muted">{t('results.waiting')}</div>}
      {slowest.map((r, i) => (
        <button
          key={`${r.ts}-${i}`}
          onClick={() => onSelect(r)}
          // `min-w-0` + `minmax(0, 1fr)` so the URL column clips instead
          // of pushing a horizontal scrollbar into the row.
          className="grid w-full min-w-0 grid-cols-[36px_minmax(0,1fr)_80px] items-center gap-2 border-b border-line py-1.5 text-left text-xs transition-colors duration-150 hover:bg-hover"
        >
          <span className="text-muted tabular-nums">#{i + 1}</span>
          <span className={r.pass ? 'text-ink' : 'text-danger'}>
            {r.status || r.error}
          </span>
          <span className="text-right font-semibold tabular-nums">{r.ms.toFixed(0)} ms</span>
        </button>
      ))}
    </div>
  );
}
