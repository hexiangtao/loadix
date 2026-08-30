import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sigma } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

interface BaseConverterToolProps {
  initialPayload?: string;
}

type Base = 2 | 8 | 10 | 16;

const BASES: { base: Base; label: string; example: string }[] = [
  { base: 2, label: 'BIN', example: '0b1010' },
  { base: 8, label: 'OCT', example: '0o12' },
  { base: 10, label: 'DEC', example: '42' },
  { base: 16, label: 'HEX', example: '0x2A' },
];

/** Parse a string in any of the 4 supported bases. Returns null if invalid. */
function parseNumber(raw: string, base: Base): bigint | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const sign = trimmed.startsWith('-') ? -1n : 1n;
  const body = trimmed.replace(/^-/, '').replace(/^0[bBoOxX]/, '');
  if (!body) return null;
  // Validate digit set per base. Base 2: 0/1; base 8: 0-7; base 10/16: 0-9 + a-f.
  if (base === 2 && !/^[01]+$/.test(body)) return null;
  if (base === 8 && !/^[0-7]+$/.test(body)) return null;
  if (!/^[0-9a-fA-F]+$/.test(body)) return null;
  try {
    const prefix = base === 2 ? '0b' : base === 8 ? '0o' : base === 16 ? '0x' : '';
    return sign * BigInt(prefix + body);
  } catch {
    return null;
  }
}

/** Format a bigint in a given base with grouping (spaces every 4 binary / 3 octal). */
function formatBase(value: bigint, base: Base): string {
  if (value === 0n) return base === 2 ? '0' : base === 8 ? '0' : base === 16 ? '0' : '0';
  const prefix = base === 2 ? '0b' : base === 8 ? '0o' : base === 16 ? '0x' : '';
  let body = value.toString(base);
  if (base === 2) body = body.replace(/(.{4})(?!$)/g, '$1 ');
  if (base === 8) body = body.replace(/(.{3})(?!$)/g, '$1 ');
  if (base === 16) body = body.toUpperCase().replace(/(.{4})(?!$)/g, '$1 ');
  return prefix + body;
}

export function BaseConverterTool({ initialPayload }: BaseConverterToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('baseconv.input', initialPayload ?? '42');
  const [base, setBase] = useState<Base>(10);

  const value = useMemo(() => parseNumber(input, base), [input, base]);
  const error = input.trim() && value === null ? t('tools.baseconv.invalid') : '';

  const formatted = useMemo(() => {
    if (value === null) return { bin: '', oct: '', dec: '', hex: '' };
    return {
      bin: formatBase(value, 2),
      oct: formatBase(value, 8),
      dec: formatBase(value, 10),
      hex: formatBase(value, 16),
    };
  }, [value]);

  return (
    <ToolShell icon={Sigma} title={t('tools.baseconv.name')}>
      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.baseconv.input')}</label>
      <input
        autoFocus
        className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="42"
        spellCheck={false}
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="self-center text-xs text-muted">{t('tools.baseconv.interpretAs')}:</span>
        {BASES.map(({ base: b, label, example }) => (
          <button
            key={b}
            onClick={() => setBase(b)}
            title={example}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ${
              base === b ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-3 grid grid-cols-1 gap-2">
        {([
          { base: 2, key: 'bin' as const, label: 'Binary' },
          { base: 8, key: 'oct' as const, label: 'Octal' },
          { base: 10, key: 'dec' as const, label: 'Decimal' },
          { base: 16, key: 'hex' as const, label: 'Hexadecimal' },
        ]).map(({ base: b, key, label }) => (
          <div key={b} className="flex items-center gap-2 rounded-lg border border-line bg-hover px-2.5 py-1.5">
            <span className="w-24 shrink-0 text-xs font-semibold text-muted">{label}</span>
            <code className="min-w-0 flex-1 truncate font-mono text-sm">{formatted[key] || '—'}</code>
            {formatted[key] && <CopyButton text={formatted[key]} className="shrink-0" />}
          </div>
        ))}
      </div>

      {value !== null && (
        <p className="mt-3 text-xs text-muted">
          {t('tools.baseconv.decimal')}: <span className="font-mono">{value.toString(10)}</span>
          {value < 0n ? ` (${t('tools.baseconv.negative')})` : ''}
        </p>
      )}
    </ToolShell>
  );
}
