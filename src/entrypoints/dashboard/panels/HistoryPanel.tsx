import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TestConfig } from '@/shared/types';
import { onStorageChange, storageGet } from '../storage';

interface HistoryPanelProps {
  onRestore: (config: TestConfig) => void;
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

export function HistoryPanel({ onRestore }: HistoryPanelProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

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
        {entries.map((entry, i) => (
          <div
            className="flex items-center justify-between rounded-lg border border-line bg-panel px-3.5 py-3"
            key={i}
          >
            <div>
              <b className="block text-[13px]">
                {entry.config.method} {entry.config.url}
              </b>
              <span className="text-xs text-muted">
                {new Date(entry.time).toLocaleString()} · {entry.requests} {t('history.requests')} · P95{' '}
                {entry.p95.toFixed(0)}ms
              </span>
            </div>
            <button className="ghost-btn" onClick={() => onRestore(entry.config)}>
              {t('history.restore')}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
