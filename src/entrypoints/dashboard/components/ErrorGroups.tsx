import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import type { MetricsSnapshot, RequestResult } from '@/shared/types';

interface ErrorGroupsProps {
  metrics: MetricsSnapshot | null;
  onSelect: (request: RequestResult) => void;
}

/**
 * Network / transport error aggregator (finishes ROADMAP Phase 1).
 *
 * Renders the top-N normalised error messages with their counts. Each row
 * expands to show the most recent sample's status / URL hint / latency and
 * the first 240 chars of its body — enough to diagnose without scrolling
 * through the recent list.
 *
 * Assertion failures are intentionally not shown here: they live in the
 * existing "Assertion Failures" panel so the two views stay focused.
 */
export function ErrorGroups({ metrics, onSelect }: ErrorGroupsProps) {
  const { t } = useTranslation();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const groups = metrics?.errorGroups ?? [];
  const max = Math.max(1, ...groups.map((g) => g.count));

  if (groups.length === 0) {
    return <div className="text-xs text-muted">{t('results.waiting')}</div>;
  }

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g, i) => {
        const open = openIdx === i;
        return (
          <div key={`${g.message}-${i}`} className="overflow-hidden rounded-lg border border-line">
            <button
              onClick={() => setOpenIdx(open ? null : i)}
              className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-hover"
            >
              <div className="flex min-w-0 items-center gap-2">
                <ChevronRight
                  size={12}
                  className={`shrink-0 text-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
                />
                <span className="truncate font-mono text-[12px] text-danger" title={g.message}>
                  {g.message}
                </span>
              </div>
              <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-line sm:block">
                <div className="h-full rounded-full bg-danger" style={{ width: `${(g.count / max) * 100}%` }} />
              </div>
              <b className="tabular-nums text-[12px] text-danger">{g.count}</b>
            </button>
            {open && g.sample && <SampleDetails sample={g.sample} onOpen={onSelect} />}
          </div>
        );
      })}
    </div>
  );
}

function SampleDetails({ sample, onOpen }: { sample: RequestResult; onOpen: (r: RequestResult) => void }) {
  return (
    <div className="border-t border-line bg-surface/40 px-3 py-2 text-[11px]">
      <div className="mb-1 flex items-center justify-between">
        <div className="grid grid-cols-[80px_1fr] gap-1.5">
          <span className="text-muted">latency</span>
          <span className="tabular-nums">{sample.ms.toFixed(0)} ms</span>
        </div>
        <button
          onClick={() => onOpen(sample)}
          className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-primary transition-colors duration-150 hover:border-primary hover:bg-primary/5"
        >
          <ExternalLink size={11} />
          details
        </button>
      </div>
      <div className="mb-1 grid grid-cols-[80px_1fr] gap-1.5">
        <span className="text-muted">time</span>
        <span>{new Date(sample.ts).toLocaleTimeString()}</span>
      </div>
      {sample.body && (
        <div>
          <span className="text-muted">body preview</span>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-panel p-2 font-mono text-[11px] text-ink">
            {sample.body.slice(0, 480)}
            {sample.body.length > 480 && '…'}
          </pre>
        </div>
      )}
    </div>
  );
}
