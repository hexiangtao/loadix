import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { usePersistedState } from '../usePersistedState';

interface TimestampToolProps {
  initialPayload?: string;
}

export function TimestampTool({ initialPayload }: TimestampToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('timestamp.input', initialPayload ?? '');
  const [now, setNow] = useState(() => Date.now());

  const parsed = useMemo(() => {
    const raw = input.trim();
    if (!raw) return null;
    // Pure digits → epoch (auto-detect seconds vs milliseconds).
    if (/^\d{10,13}$/.test(raw)) {
      const num = Number(raw);
      const ms = num < 1e12 ? num * 1000 : num;
      const d = new Date(ms);
      return { date: d, valid: !Number.isNaN(d.getTime()) };
    }
    const d = new Date(raw);
    return { date: d, valid: !Number.isNaN(d.getTime()) };
  }, [input]);

  const current = {
    epochMs: now,
    epochSec: Math.floor(now / 1000),
    iso: new Date(now).toISOString(),
    local: new Date(now).toLocaleString(),
  };

  return (
    <ToolShell icon={Clock} title={t('tools.timestamp.name')}>
      <div className="mb-4 grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
        <div className="rounded-lg border border-line bg-hover px-3 py-2.5">
          <span className="mb-1 block text-[11px] text-muted">{t('tools.timestamp.epochSec')}</span>
          <b className="font-mono text-sm">{current.epochSec}</b>
        </div>
        <div className="rounded-lg border border-line bg-hover px-3 py-2.5">
          <span className="mb-1 block text-[11px] text-muted">{t('tools.timestamp.epochMs')}</span>
          <b className="font-mono text-sm">{current.epochMs}</b>
        </div>
        <div className="px-3 py-2.5 rounded-lg border border-line bg-hover">
          <span className="mb-1 block text-[11px] text-muted">ISO 8601</span>
          <b className="font-mono text-sm">{current.iso}</b>
        </div>
        <div className="px-3 py-2.5 rounded-lg border border-line bg-hover">
          <span className="mb-1 block text-[11px] text-muted">{t('tools.timestamp.local')}</span>
          <b className="font-mono text-sm">{current.local}</b>
        </div>
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.timestamp.input')}</label>
      <input
        autoFocus
        className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="1735689600 或 2026-01-01T00:00:00Z"
      />

      {input.trim() && (
        <div className="mt-3 rounded-lg border border-line bg-hover px-3 py-2.5">
          {parsed && parsed.valid ? (
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-mono">{parsed.date.toISOString()}</span>
              <span className="text-xs text-muted">{parsed.date.toLocaleString()}</span>
            </div>
          ) : (
            <span className="text-xs text-danger">{t('tools.timestamp.invalid')}</span>
          )}
        </div>
      )}

      <button onClick={() => setNow(Date.now())} className="ghost-btn mt-4 text-sm">
        {t('tools.timestamp.refresh')}
      </button>
    </ToolShell>
  );
}
