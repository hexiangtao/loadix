import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

function locateJsonError(raw: string, e: unknown): string {
  if (!(e instanceof SyntaxError)) return '';
  // V8 messages look like "Unexpected token } in JSON at position 12".
  const m = /position (\d+)/.exec(e.message);
  if (!m) return '';
  const pos = Number(m[1]);
  const line = raw.slice(0, pos).split('\n').length;
  return `line ${line}, col ${pos}`;
}

interface JsonToolProps {
  /** Content routed from the smart-paste box (pre-fills the input). */
  initialPayload?: string;
}

export function JsonTool({ initialPayload }: JsonToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('json.input', initialPayload ?? '');
  const [indent, setIndent] = useState(2);

  const result = useMemo(() => {
    if (!input.trim()) return { ok: true, text: '', stats: null };
    try {
      const parsed = JSON.parse(input);
      const text = JSON.stringify(parsed, null, indent);
      const keys = countKeys(parsed);
      const depth = maxDepth(parsed);
      const bytes = new Blob([text]).size;
      return { ok: true, text, stats: { keys, depth, bytes } };
    } catch (e) {
      return { ok: false, text: '', stats: null, error: locateJsonError(input, e) };
    }
  }, [input, indent]);

  const minified = useMemo(() => {
    if (!input.trim()) return '';
    try {
      return JSON.stringify(JSON.parse(input));
    } catch {
      return '';
    }
  }, [input]);

  return (
    <ToolShell icon={Braces} title={t('tools.json.name')}>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex gap-1.5">
          {[2, 4].map((n) => (
            <button
              key={n}
              onClick={() => setIndent(n)}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors duration-150 ${
                indent === n ? 'bg-primary/10 font-semibold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
              }`}
            >
              {n} {t('tools.json.spaces')}
            </button>
          ))}
        </div>
        {minified && <CopyButton text={minified} className="ml-auto" />}
      </div>

      <textarea
        autoFocus
        className="field min-h-[140px] w-full flex-1 resize-y font-mono text-sm"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder='{"hello":"world","nested":{"a":[1,2,3]}}'
      />

      {result.ok && result.stats && (
        <p className="mt-2 text-xs text-muted">
          {t('tools.json.keys')}: <b>{result.stats.keys}</b> · {t('tools.json.depth')}: <b>{result.stats.depth}</b> ·{' '}
          {t('tools.json.size')}: <b>{formatBytes(result.stats.bytes)}</b>
        </p>
      )}

      {!result.ok && (
        <p className="mt-2 text-xs text-danger">
          {t('tools.json.invalid')}
          {result.error ? ` (${result.error})` : ''}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between">
        <label className="text-xs font-semibold text-muted">{t('tools.json.formatted')}</label>
        {result.ok && result.text && <CopyButton text={result.text} />}
      </div>
      <pre className="field mt-1.5 min-h-[140px] w-full flex-1 overflow-auto font-mono text-sm">
        {result.text}
      </pre>
    </ToolShell>
  );
}

function countKeys(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((n, x) => n + countKeys(x), 0);
  if (v && typeof v === 'object') {
    return Object.keys(v as object).length + Object.values(v as object).reduce((n, x) => n + countKeys(x), 0);
  }
  return 0;
}

function maxDepth(v: unknown, d = 0): number {
  if (v && typeof v === 'object') {
    const children = Object.values(v as object);
    if (!children.length) return d;
    return Math.max(...children.map((c) => maxDepth(c, d + 1)));
  }
  return d;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
