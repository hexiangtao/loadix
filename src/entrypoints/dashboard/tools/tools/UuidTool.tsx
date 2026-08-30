import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';

type UuidVersion = 'v4' | 'v7';

function uuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for non-secure contexts.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  if (bytes[6] !== undefined) bytes[6] = (bytes[6] & 0x0f) | 0x40;
  if (bytes[8] !== undefined) bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** UUIDv7: time-ordered, 48-bit ms timestamp + random. */
function uuidV7(): string {
  const ts = Date.now();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  if (bytes[6] !== undefined) bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  if (bytes[8] !== undefined) bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface UuidToolProps {
  initialPayload?: string;
}

export function UuidTool({ initialPayload }: UuidToolProps) {
  const { t } = useTranslation();
  const [version, setVersion] = useState<'v4' | 'v7'>('v4');
  const [count, setCount] = useState(5);
  const [items, setItems] = useState<string[]>(() => Array.from({ length: 5 }, () => uuidV4()));
  void initialPayload;

  const generate = () => {
    const gen = version === 'v4' ? uuidV4 : uuidV7;
    setItems(Array.from({ length: count }, () => gen()));
  };

  return (
    <ToolShell icon={Fingerprint} title={t('tools.uuid.name')}>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex gap-1.5">
          {(['v4', 'v7'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVersion(v)}
              className={`rounded-lg px-3.5 py-2 text-sm transition-colors duration-150 ${
                version === v ? 'bg-primary/10 font-semibold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
              }`}
            >
              {v.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-muted">
          {t('tools.uuid.count')}
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Math.min(100, Math.max(1, +e.target.value || 1)))}
            className="w-20 rounded-lg border border-line bg-panel px-2.5 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        <button onClick={generate} className="primary-btn text-sm">
          {t('tools.uuid.generate')}
        </button>
        {items.length > 0 && <CopyButton text={items.join('\n')} className="ml-auto" />}
      </div>

      <div className="flex flex-col gap-1.5">
        {items.map((u, i) => (
          <div key={`${u}-${i}`} className="flex items-center gap-2 rounded-lg border border-line bg-hover px-3 py-2">
            <span className="flex-1 font-mono text-sm break-all">{u}</span>
            <CopyButton text={u} className="shrink-0" />
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted">{t('tools.uuid.hint')}</p>
    </ToolShell>
  );
}
