import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ProgressBarProps {
  /** Whether the engine is currently running. */
  running: boolean;
  /** Total configured duration in seconds. */
  durationSec: number;
}

/**
 * Slim progress bar + countdown shown above the verdict card while a run is
 * in flight. Tracks wall-clock time from when `running` flipped to true, so
 * the visual matches the engine's own duration timer without needing any new
 * message from the SW.
 *
 * Returns null when not running, so the bar disappears cleanly between runs.
 */
export function ProgressBar({ running, durationSec }: ProgressBarProps) {
  const { t } = useTranslation();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [startTs, setStartTs] = useState<number | null>(null);

  useEffect(() => {
    if (running) {
      setStartTs(Date.now());
      setElapsedMs(0);
      const id = window.setInterval(() => setElapsedMs(Date.now() - (startTs ?? Date.now())), 200);
      return () => window.clearInterval(id);
    }
    setStartTs(null);
    return undefined;
  }, [running]); // intentionally not depending on startTs (would loop)

  if (!running || startTs === null) return null;

  const total = Math.max(1, durationSec) * 1000;
  const pct = Math.min(100, (elapsedMs / total) * 100);
  const remainingSec = Math.max(0, Math.ceil((total - elapsedMs) / 1000));
  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-muted">
        {fmt(remainingSec)} / {fmt(durationSec)}
      </span>
      <span className="sr-only">{t('results.running')}</span>
    </div>
  );
}
