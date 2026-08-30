import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { usePersistedState } from '../usePersistedState';

const FIELD_KEYS = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

const RANGES: Record<FieldKey, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
};

interface CronToolProps {
  initialPayload?: string;
}

/** Validate one cron field expression against its numeric range. */
function validField(expr: string, [lo, hi]: [number, number]): boolean {
  if (!/^[\d*,/-]+$/.test(expr)) return false;
  if (expr === '*') return true;
  return expr.split(',').every((part) => {
    if (part === '*') return true;
    const step = /^\*\/(\d+)$/.exec(part);
    if (step) return Number(step[1]) >= 1;
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) return Number(range[1]) >= lo && Number(range[2]) <= hi;
    const n = Number(part);
    return Number.isInteger(n) && n >= lo && n <= hi;
  });
}

function fieldMatches(expr: string, value: number): boolean {
  return expr.split(',').some((part) => {
    if (part === '*') return true;
    const step = /^\*\/(\d+)$/.exec(part);
    if (step) return value % Number(step[1]) === 0;
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    return value === Number(part);
  });
}

function cronMatches(parts: string[], d: Date): boolean {
  const values = [d.getMinutes(), d.getHours(), d.getDate(), d.getMonth() + 1, d.getDay()];
  return parts.every((expr, i) => fieldMatches(expr ?? '*', values[i] ?? 0));
}

/** Next N matching minutes (searches forward minute by minute, capped). */
function nextCronDates(expr: string, count: number): Date[] {
  const parts = expr.trim().split(/\s+/);
  const out: Date[] = [];
  const cursor = new Date();
  cursor.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 366 && out.length < count; i++) {
    cursor.setMinutes(cursor.getMinutes() + 1);
    if (cronMatches(parts, cursor)) out.push(new Date(cursor));
  }
  return out;
}

export function CronTool({ initialPayload }: CronToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('cron.input', initialPayload ?? '0 9 * * 1-5');

  const parsed = useMemo(() => {
    const parts = input.trim().split(/\s+/);
    if (parts.length !== 5) return { ok: false as const, fields: [] as string[] };
    for (let i = 0; i < 5; i++) {
      const expr = parts[i];
      const key = FIELD_KEYS[i];
      const range = key ? RANGES[key] : undefined;
      if (!expr || !range || !validField(expr, range)) return { ok: false as const, fields: [] as string[] };
    }
    return { ok: true as const, fields: parts };
  }, [input]);

  const nextRuns = useMemo(() => (parsed.ok ? nextCronDates(input, 5) : []), [input, parsed.ok]);

  const fields = parsed.ok ? parsed.fields : [];

  return (
    <ToolShell icon={CalendarClock} title={t('tools.cron.name')}>
      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.cron.input')}</label>
      <input
        autoFocus
        className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="*/5 * * * *"
      />

      {!parsed.ok && <p className="mt-2 text-xs text-danger">{t('tools.cron.invalid')}</p>}

      {parsed.ok && (
        <>
          <div className="mt-4 grid grid-cols-5 gap-2 max-md:grid-cols-2">
            {FIELD_KEYS.map((f, i) => (
              <div key={f} className="rounded-lg border border-line bg-hover px-3 py-2.5">
                <span className="mb-1 block text-[11px] text-muted">{t(`tools.cron.${f}`)}</span>
                <b className="font-mono text-sm">{fields[i] ?? '*'}</b>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <span className="text-xs font-semibold text-muted">{t('tools.cron.next')}</span>
            <div className="mt-2 flex flex-col gap-1.5">
              {nextRuns.map((d, i) => (
                <div key={i} className="rounded-lg border border-line bg-hover px-3 py-2 font-mono text-sm">
                  {d.toLocaleString()}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <p className="mt-4 text-xs text-muted">{t('tools.cron.hint')}</p>
    </ToolShell>
  );
}
