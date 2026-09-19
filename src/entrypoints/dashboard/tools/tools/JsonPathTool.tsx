import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { JSONPath } from 'jsonpath-plus';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

interface JsonPathToolProps {
  initialPayload?: string;
}

const PRESETS: { label: string; path: string }[] = [
  { label: '$.store.book[*]', path: '$.store.book[*]' },
  { label: 'All authors', path: '$.store.book[*].author' },
  { label: 'Cheapest (min)', path: '$.store.book[?(@.price==min($.store.book[*].price))].title' },
  { label: 'Filter: price < 10', path: '$.store.book[?(@.price<10)]' },
  { label: 'Last book', path: '$.store.book[-1:]' },
  { label: 'Recursive: all prices', path: '$..price' },
  { label: 'Slice [1:3]', path: '$.store.book[1:3]' },
];

const SAMPLE = `{
  "store": {
    "book": [
      { "category": "reference", "title": "Sayings of the Century", "price": 8.95 },
      { "category": "fiction", "title": "Moby Dick", "price": 12.99, "isbn": "0-553-21311-3" },
      { "category": "fiction", "title": "The Lord of the Rings", "price": 22.99, "isbn": "0-395-19395-8" }
    ],
    "bicycle": { "color": "red", "price": 19.95 }
  }
}`;

export function JsonPathTool({ initialPayload }: JsonPathToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('jsonpath.input', initialPayload ?? '');
  const [path, setPath] = usePersistedState('jsonpath.path', '$.store.book[*].title');
  const [queryError, setQueryError] = useState('');

  const parsed = useMemo(() => {
    if (!input.trim()) return { ok: true as const, data: null as unknown, err: '' };
    try {
      return { ok: true as const, data: JSON.parse(input) as unknown, err: '' };
    } catch (e) {
      return { ok: false as const, data: null as unknown, err: (e as Error).message };
    }
  }, [input]);

  // jsonpath-plus throws on an invalid expression; keep the last good result
  // on screen while the user types rather than flashing to empty.
  const matches = useMemo(() => {
    if (!parsed.ok || parsed.data == null) return [] as unknown[];
    try {
      const result = JSONPath({ path, json: parsed.data, wrap: true }) as unknown[];
      setQueryError('');
      return result;
    } catch (e) {
      setQueryError((e as Error).message.slice(0, 160));
      return [] as unknown[];
    }
  }, [parsed, path]);

  const preview = (v: unknown): string => {
    const s = JSON.stringify(v, null, 2);
    return s.length > 400 ? s.slice(0, 400) + '\n…' : s;
  };

  return (
    <ToolShell icon={Search} title={t('tools.jsonpath.name')}>
      <label className="mb-1.5 block text-xs font-semibold text-muted">JSON</label>
      <textarea
        autoFocus
        className="min-h-[120px] w-full flex-1 resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={SAMPLE}
      />
      {input.trim() === '' && (
        <button
          onClick={() => setInput(SAMPLE)}
          className="mt-1.5 text-xs text-primary hover:underline"
        >
          {t('tools.jsonpath.loadSample')}
        </button>
      )}

      {!parsed.ok && <p className="mt-2 text-xs text-danger">{t('tools.json.invalid')} · {parsed.err}</p>}

      <label className="mb-1.5 mt-3 block text-xs font-semibold text-muted">JSONPath</label>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">{t('tools.jsonpath.presets')}</span>
        {PRESETS.map((p) => (
          <button
            key={p.path}
            onClick={() => setPath(p.path)}
            className="rounded-md border border-line px-2 py-1 font-mono text-[11px] text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        className="mt-1.5 w-full rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="$.store.book[*].title"
      />
      {queryError && <p className="mt-1.5 text-xs text-danger">{queryError}</p>}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">
          {t('tools.jsonpath.matches')}: <b className="text-ink">{matches.length}</b>
        </span>
        {matches.length > 0 && <CopyButton text={JSON.stringify(matches, null, 2)} />}
      </div>
      <pre className="mt-1.5 max-h-[260px] min-h-[80px] w-full overflow-auto rounded-lg border border-line bg-hover px-2.5 py-2 font-mono text-xs">
        {matches.length === 0 ? '—' : matches.map((m, i) => `[${i}] ${preview(m)}`).join('\n')}
      </pre>
    </ToolShell>
  );
}
