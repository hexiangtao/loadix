import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, RotateCcw } from 'lucide-react';
import type { TestConfig } from '@/shared/types';
import type { EngineHost } from '@/engine/engine-host';
import { onStorageChange, storageGet } from '../storage';

interface HistoryPanelProps {
  onRestore: (config: TestConfig) => void;
  /** EngineHost so "Re-run" can fire a fresh run without bouncing
   *  through the Restore step. */
  host: EngineHost;
  /** True while the engine is running — disables Re-run on every entry. */
  busy?: boolean;
}

interface HistoryEntry {
  time: string;
  config: TestConfig;
  requests: number;
  avg: number;
  p95: number;
  success: number;
}

const HISTORY_KEY = 'api-pressure-history';

export function HistoryPanel({ onRestore, host, busy }: HistoryPanelProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [runningIdx, setRunningIdx] = useState<number | null>(null);

  useEffect(() => {
    storageGet<HistoryEntry[]>(HISTORY_KEY).then((data) => {
      setEntries(data ?? []);
    });
    return onStorageChange(HISTORY_KEY, (newValue) => {
      setEntries((newValue as HistoryEntry[]) ?? []);
    });
  }, []);

  return (
    <section className="panel">
      <div className="flex flex-col gap-2.5">
        {entries.length === 0 && <div className="text-xs text-muted">{t('history.empty')}</div>}
        {entries.map((entry, i) => {
          const isRunning = runningIdx === i;
          return (
            <div
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel px-3.5 py-3"
              key={i}
            >
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[13px]">
                  {entry.config.method} {entry.config.url}
                </b>
                <span className="text-xs text-muted">
                  {new Date(entry.time).toLocaleString()} · {entry.requests} {t('history.requests')} · P95{' '}
                  {entry.p95.toFixed(0)}ms
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  className="ghost-btn flex items-center gap-1"
                  onClick={() => onRestore(entry.config)}
                  title={t('history.restoreHint')}
                >
                  <RotateCcw size={12} />
                  {t('history.restore')}
                </button>
                <button
                  className="primary-btn flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={busy || isRunning}
                  onClick={() => {
                    setRunningIdx(i);
                    host.start(entry.config);
                  }}
                  title={t('history.rerunHint')}
                >
                  <Play size={12} />
                  {isRunning ? t('history.running') : t('history.rerun')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
