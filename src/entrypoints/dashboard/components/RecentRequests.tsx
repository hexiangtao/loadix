import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Search, X } from 'lucide-react';
import type { MetricsSnapshot, RequestResult } from '@/shared/types';

interface RecentRequestsProps {
  metrics: MetricsSnapshot | null;
  onSelect: (request: RequestResult) => void;
}

type PassFilter = 'all' | 'pass' | 'fail';

/**
 * Recent requests with a search box and pass/fail filter so users can
 * isolate the interesting entries without scrolling through 30 of them.
 *
 * Filtering is intentionally local — we only slice the in-memory ring
 * buffer, not the engine state — so toggling the filter is instantaneous
 * even on a hot run.
 */
export function RecentRequests({ metrics, onSelect }: RecentRequestsProps) {
  const { t } = useTranslation();
  const [pass, setPass] = useState<PassFilter>('all');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const recent = metrics?.recent ?? [];
    const q = query.trim().toLowerCase();
    return recent.filter((r) => {
      if (pass === 'pass' && !r.pass) return false;
      if (pass === 'fail' && r.pass) return false;
      if (!q) return true;
      // Match against the visible fields: status, error message, URL hint.
      // Body is excluded — it could be huge and the search would feel laggy.
      const haystack = `${r.status} ${r.error}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [metrics?.recent, pass, query]);

  const total = metrics?.recent.length ?? 0;
  const shown = visible.length;

  return (
    <div className="flex flex-col">
      {/* Filter bar: pass/fail toggle + free-text search. Sticks to the
          top of the panel so it stays visible while the user scrolls the
          request list. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <FilterChip active={pass === 'all'} onClick={() => setPass('all')} label={t('results.filterAll')} />
        <FilterChip active={pass === 'fail'} onClick={() => setPass('fail')} label={t('results.filterFail')} tone="danger" />
        <FilterChip active={pass === 'pass'} onClick={() => setPass('pass')} label={t('results.filterPass')} tone="success" />
        <div className="relative ml-auto flex-1 min-w-[140px]">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="w-full rounded-md border border-line bg-panel py-1 pl-7 pr-6 text-[11px] outline-none transition-colors focus:border-primary"
            placeholder={t('results.filterSearch')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:bg-hover hover:text-ink"
              aria-label={t('results.filterClear')}
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="text-[10px] text-muted">
        {t('results.filterCount', { shown, total })}
      </div>

      <div className="mt-1 flex max-h-60 min-h-30 flex-col overflow-auto">
        {total === 0 && <div className="text-xs text-muted">{t('results.waiting')}</div>}
        {total > 0 && shown === 0 && (
          <div className="text-xs text-muted">{t('results.filterEmpty')}</div>
        )}
        {visible.map((r, i) => (
          <button
            key={`${r.ts}-${i}`}
            onClick={() => onSelect(r)}
            className="grid w-full grid-cols-[90px_60px_1fr_80px] gap-2 border-b border-line py-1.5 text-left text-xs transition-colors duration-150 hover:bg-hover"
          >
            <span>{new Date(r.ts).toLocaleTimeString()}</span>
            <span className={r.pass ? 'font-bold text-success' : 'font-bold text-danger'}>{r.pass ? 'PASS' : 'FAIL'}</span>
            <span className="truncate">{r.status || r.error}</span>
            <span className="text-right tabular-nums">{r.ms.toFixed(0)} ms</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  tone = 'default',
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: 'default' | 'success' | 'danger';
}) {
  const activeCls =
    tone === 'danger'
      ? 'bg-danger/15 text-danger'
      : tone === 'success'
        ? 'bg-success/15 text-success'
        : 'bg-primary/10 text-primary';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors duration-150 ${
        active ? activeCls : 'text-muted hover:bg-hover hover:text-ink'
      }`}
    >
      {active && tone === 'success' && <Check size={11} />}
      {label}
    </button>
  );
}
