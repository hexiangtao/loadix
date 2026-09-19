import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Sparkles } from 'lucide-react';
import cronstrue from 'cronstrue/i18n';
import { CronExpressionParser } from 'cron-parser';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

/** Map the app's i18n languages onto cronstrue locales. */
const CRONSTRUE_LOCALES: Record<string, string> = {
  en: 'en',
  'zh-CN': 'zh_CN',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
};

interface CronToolProps {
  initialPayload?: string;
}

const EXAMPLES = [
  { expr: '*/5 * * * *', label: 'Every 5 min' },
  { expr: '0 9 * * 1-5', label: 'Weekdays 9am' },
  { expr: '0 0 1 * *', label: 'Monthly' },
  { expr: '30 2 * * 0', label: 'Sun 2:30am' },
  { expr: '0 */6 * * *', label: 'Every 6 hours' },
];

export function CronTool({ initialPayload }: CronToolProps) {
  const { t, i18n } = useTranslation();
  const [input, setInput] = usePersistedState('cron.input', initialPayload ?? '*/5 * * * *');

  const parsed = useMemo(() => {
    const expr = input.trim();
    if (!expr) return { ok: false as const, description: '', nextRuns: [] as string[] };
    try {
      const locale = CRONSTRUE_LOCALES[i18n.language] ?? 'en';
      const description = cronstrue.toString(expr, { locale, use24HourTimeFormat: true });
      const interval = CronExpressionParser.parse(expr, { currentDate: new Date() });
      const nextRuns: string[] = [];
      for (let i = 0; i < 5; i++) {
        nextRuns.push(interval.next().toDate().toLocaleString());
      }
      return { ok: true as const, description, nextRuns };
    } catch (e) {
      return { ok: false as const, description: (e as Error).message.slice(0, 160), nextRuns: [] };
    }
  }, [input, i18n.language]);

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

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">{t('tools.cron.examples')}</span>
        {EXAMPLES.map((e) => (
          <button
            key={e.expr}
            onClick={() => setInput(e.expr)}
            className="rounded-md border border-line px-2 py-1 font-mono text-[11px] text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
          >
            {e.label}
          </button>
        ))}
      </div>

      {parsed.ok ? (
        <>
          {parsed.description && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-primary" />
              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {t('tools.cron.meaning')}
                </span>
                <p className="mt-0.5 text-sm font-semibold text-ink">{parsed.description}</p>
              </div>
            </div>
          )}

          {parsed.nextRuns.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted">{t('tools.cron.next')}</span>
                <CopyButton text={parsed.nextRuns.join('\n')} />
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {parsed.nextRuns.map((d, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border border-line bg-hover px-3 py-2 font-mono text-sm">
                    <span className="w-5 shrink-0 text-xs text-muted">{i + 1}</span>
                    {d}
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted">{t('tools.cron.tzHint')}</p>
            </div>
          )}
        </>
      ) : (
        <p className="mt-4 text-xs text-danger">
          {t('tools.cron.invalid')}
          {parsed.description ? ` · ${parsed.description}` : ''}
        </p>
      )}

      <p className="mt-4 text-xs text-muted">{t('tools.cron.hint')}</p>
    </ToolShell>
  );
}
