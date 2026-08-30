import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Regex } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

const TEMPLATES: [string, string][] = [
  ['Email', '[\\w.+-]+@[\\w-]+\\.[\\w.]+'],
  ['URL', 'https?://[\\w.-]+(?:/\\S*)?'],
  ['IPv4', '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b'],
  ['手机号', '1[3-9]\\d{9}'],
  ['Date', '\\d{4}-\\d{2}-\\d{2}'],
];

interface Match {
  index: number;
  text: string;
}

interface RegexToolProps {
  /** Content routed from the smart-paste box (pre-fills the test text). */
  initialPayload?: string;
}

export function RegexTool({ initialPayload }: RegexToolProps) {
  const { t } = useTranslation();
  const [pattern, setPattern] = usePersistedState('regex.pattern', '');
  const [text, setText] = usePersistedState('regex.text', initialPayload ?? '');

  const result = useMemo(() => {
    if (!pattern) return { matches: [] as Match[], groups: [] as string[][], error: '' };
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'g');
    } catch (e) {
      return { matches: [] as Match[], groups: [] as string[][], error: (e as Error).message };
    }
    const matches: Match[] = [];
    const groups: string[][] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({ index: m.index, text: m[0] });
      if (m.length > 1) groups.push(Array.from(m.slice(1)));
      if (m[0] === '') re.lastIndex++; // avoid infinite loop on empty match
    }
    return { matches, groups, error: '' };
  }, [pattern, text]);

  return (
    <ToolShell icon={Regex} title={t('tools.regex.name')}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-muted">{t('tools.regex.templates')}</span>
        {TEMPLATES.map(([label, pat]) => (
          <button
            key={label}
            onClick={() => setPattern(pat)}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
          >
            {label}
          </button>
        ))}
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.regex.pattern')}</label>
      <input
        autoFocus
        className="field w-full font-mono text-sm"
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
        placeholder="[\\w.+-]+@[\\w-]+\\.[\\w.]+"
      />

      {result.error && <p className="mt-1.5 text-xs text-danger">{result.error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <label className="text-xs font-semibold text-muted">{t('tools.regex.test')}</label>
        <span className="text-xs text-muted">
          {t('tools.regex.matches')}: <b className="text-ink">{result.matches.length}</b>
        </span>
      </div>
      <textarea
        className="field min-h-[120px] w-full flex-1 resize-y font-mono text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('tools.regex.placeholder')}
      />
      <HighlightedText text={text} matches={result.matches} />

      {result.groups.length > 0 && (
        <div className="mt-4">
          <span className="text-xs font-semibold text-muted">{t('tools.regex.groups')}</span>
          <div className="mt-2 flex flex-col gap-1.5">
            {result.groups.slice(0, 20).map((g, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">#{i + 1}</span>
                {g.map((v, gi) => (
                  <span key={gi} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-xs">
                    <span className="text-muted">${gi + 1}</span>
                    <span className="max-w-[300px] truncate">{v}</span>
                    <CopyButton text={v} className="border-0 px-1 py-0 text-[10px]" />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </ToolShell>
  );
}

function HighlightedText({ text, matches }: { text: string; matches: Match[] }) {
  if (!text) return null;
  const nodes: { str: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of matches) {
    if (m.index > last) nodes.push({ str: text.slice(last, m.index), hit: false });
    nodes.push({ str: m.text, hit: true });
    last = m.index + m.text.length;
  }
  if (last < text.length) nodes.push({ str: text.slice(last), hit: false });

  return (
    <div className="mt-2 min-h-[40px] max-h-[160px] overflow-auto rounded-lg border border-line bg-hover p-2.5 font-mono text-sm whitespace-pre-wrap break-all">
      {nodes.map((n, i) =>
        n.hit ? (
          <mark key={i} className="rounded bg-warning/30 text-ink">
            {n.str}
          </mark>
        ) : (
          <span key={i}>{n.str}</span>
        ),
      )}
    </div>
  );
}
