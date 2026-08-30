import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

interface JsonPathToolProps {
  initialPayload?: string;
}

/** Minimal JSONPath subset: $ . [a] .[n] .* .. wildcard-free path. */
type Token = { kind: 'root' } | { kind: 'key'; name: string } | { kind: 'index'; i: number } | { kind: 'wild' };

function parsePath(expr: string): Token[] {
  const tokens: Token[] = [{ kind: 'root' }];
  const s = expr.replace(/\s+/g, '');
  if (s === '$') return tokens;
  // Use a single regex to walk segments.
  const re = /(\.\[(\d+)\])|(\.([\w-]+))|(\.\.)|(\.)|(\[(\d+)\])|(\[\*\])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1] && m[2]) tokens.push({ kind: 'index', i: Number(m[2]) });
    else if (m[3] && m[4]) tokens.push({ kind: 'key', name: m[4] });
    else if (m[5] || m[6]) tokens.push({ kind: 'wild' });
    else if (m[7] && m[8]) tokens.push({ kind: 'index', i: Number(m[8]) });
    else if (m[9]) tokens.push({ kind: 'wild' });
  }
  return tokens;
}

function applyPath(tokens: Token[], data: unknown): unknown[] {
  const results: unknown[] = [];
  const walk = (node: unknown, idx: number) => {
    const t = tokens[idx];
    if (!t) {
      results.push(node);
      return;
    }
    if (t.kind === 'root') {
      walk(node, idx + 1);
      return;
    }
    if (node == null) return;
    if (t.kind === 'key' && typeof node === 'object') {
      const v = (node as Record<string, unknown>)[t.name];
      if (v !== undefined) walk(v, idx + 1);
    } else if (t.kind === 'index' && Array.isArray(node)) {
      const v = node[t.i];
      if (v !== undefined) walk(v, idx + 1);
    } else if (t.kind === 'wild') {
      if (Array.isArray(node)) {
        for (const v of node) walk(v, idx + 1);
      } else if (node && typeof node === 'object') {
        for (const v of Object.values(node as Record<string, unknown>)) walk(v, idx + 1);
      }
    }
  };
  walk(data, 0);
  return results;
}

const PRESETS: { label: string; path: string }[] = [
  { label: 'All users', path: '$.users[*]' },
  { label: 'First user name', path: '$.users[0].name' },
  { label: 'All user ids', path: '$.users[*].id' },
  { label: 'Tag names', path: '$.items[*].tags[*]' },
];

export function JsonPathTool({ initialPayload }: JsonPathToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('jsonpath.input', initialPayload ?? '');
  const [path, setPath] = usePersistedState('jsonpath.path', '$.users[*].name');

  const parsed = useMemo(() => {
    if (!input.trim()) return { ok: true as const, data: null, err: '' };
    try {
      return { ok: true as const, data: JSON.parse(input) as unknown, err: '' };
    } catch (e) {
      return { ok: false as const, data: null, err: (e as Error).message };
    }
  }, [input]);

  const matches = useMemo(() => {
    if (!parsed.ok || parsed.data == null) return [] as unknown[];
    try {
      return applyPath(parsePath(path), parsed.data);
    } catch {
      return [];
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
        placeholder='{"users":[{"id":1,"name":"Alice","tags":["admin","a"]}]}'
      />

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
        placeholder="$.users[*].name"
      />

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">
          {t('tools.jsonpath.matches')}: <b className="text-ink">{matches.length}</b>
        </span>
        {matches.length > 0 && <CopyButton text={JSON.stringify(matches, null, 2)} />}
      </div>
      <pre className="mt-1.5 max-h-[200px] min-h-[80px] w-full overflow-auto rounded-lg border border-line bg-hover px-2.5 py-2 font-mono text-xs">
        {matches.length === 0 ? '—' : matches.map((m, i) => `[${i}] ${preview(m)}`).join('\n')}
      </pre>
    </ToolShell>
  );
}
