import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitCompareArrows, Plus, Minus, Equal } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

interface DiffToolProps {
  initialPayload?: string;
}

type View = 'unified' | 'split';
type Unit = 'line' | 'word';

interface Row {
  kind: 'eq' | 'add' | 'del' | 'mod';
  left?: string;
  right?: string;
}

/**
 * Compute a line-level diff using the classic LCS dynamic-programming
 * algorithm. O(n*m) memory; fine for typical config / response sizes
 * (a few thousand lines each). Returns a list of rows that the renderer
 * turns into the unified or side-by-side view.
 */
function lineDiff(a: string, b: string): Row[] {
  const left = a.split('\n');
  const right = b.split('\n');
  const n = left.length;
  const m = right.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = left[i] === right[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      rows.push({ kind: 'eq', left: left[i], right: right[j] });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ kind: 'del', left: left[i] });
      i++;
    } else {
      rows.push({ kind: 'add', right: right[j] });
      j++;
    }
  }
  while (i < n) {
    rows.push({ kind: 'del', left: left[i++] });
  }
  while (j < m) {
    rows.push({ kind: 'add', right: right[j++] });
  }
  // Pair adjacent del+add as 'mod' to highlight in-place changes.
  for (let k = 0; k < rows.length - 1; k++) {
    if (rows[k]!.kind === 'del' && rows[k + 1]!.kind === 'add') {
      rows[k] = { kind: 'mod', left: rows[k]!.left, right: rows[k + 1]!.right };
      rows.splice(k + 1, 1);
    }
  }
  return rows;
}

const SAMPLES = [
  { name: 'Config (A → B)', left: 'host: api.example.com\nport: 80\nretries: 3\ntimeout: 5000', right: 'host: api.example.com\nport: 443\nretries: 5\ntimeout: 5000' },
  { name: 'JSON response', left: '{\n  "id": 1,\n  "name": "Alice",\n  "role": "user"\n}', right: '{\n  "id": 1,\n  "name": "Alice",\n  "role": "admin",\n  "active": true\n}' },
  { name: 'HTTP headers', left: 'GET /api/v1/users HTTP/1.1\nHost: api.example.com\nAccept: application/json', right: 'GET /api/v2/users HTTP/1.1\nHost: api.example.com\nAccept: application/json\nAuthorization: Bearer xyz' },
];

export function DiffTool({ initialPayload }: DiffToolProps) {
  const { t } = useTranslation();
  const [left, setLeft] = usePersistedState('diff.left', initialPayload ?? SAMPLES[0]!.left);
  const [right, setRight] = usePersistedState('diff.right', SAMPLES[0]!.right);
  const [view, setView] = useState<View>('unified');

  const rows = useMemo(() => lineDiff(left, right), [left, right]);
  const stats = useMemo(() => {
    let add = 0;
    let del = 0;
    let eq = 0;
    for (const r of rows) {
      if (r.kind === 'add') add++;
      else if (r.kind === 'del') del++;
      else if (r.kind === 'mod') {
        add++;
        del++;
      } else eq++;
    }
    return { add, del, eq };
  }, [rows]);

  const unified = useMemo(
    () =>
      rows
        .map((r) => {
          if (r.kind === 'eq') return `  ${r.left}`;
          if (r.kind === 'add') return `+ ${r.right ?? ''}`;
          if (r.kind === 'del') return `- ${r.left ?? ''}`;
          return `- ${r.left ?? ''}\n+ ${r.right ?? ''}`;
        })
        .join('\n'),
    [rows],
  );

  const loadSample = (i: number) => {
    setLeft(SAMPLES[i]!.left);
    setRight(SAMPLES[i]!.right);
  };

  return (
    <ToolShell icon={GitCompareArrows} title={t('tools.diff.name')}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{t('tools.diff.samples')}:</span>
        {SAMPLES.map((s, i) => (
          <button
            key={s.name}
            onClick={() => loadSample(i)}
            className="max-w-[200px] truncate rounded-md border border-line px-2 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
            title={s.name}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold text-muted">{t('tools.diff.original')}</label>
            {left && <CopyButton text={left} className="shrink-0" />}
          </div>
          <textarea
            className="min-h-[180px] w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
            value={left}
            onChange={(e) => setLeft(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold text-muted">{t('tools.diff.changed')}</label>
            {right && <CopyButton text={right} className="shrink-0" />}
          </div>
          <textarea
            className="min-h-[180px] w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
            value={right}
            onChange={(e) => setRight(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setView('unified')}
            className={`rounded-md px-2.5 py-1 transition-colors duration-150 ${
              view === 'unified' ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {t('tools.diff.unified')}
          </button>
          <button
            onClick={() => setView('split')}
            className={`rounded-md px-2.5 py-1 transition-colors duration-150 ${
              view === 'split' ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {t('tools.diff.split')}
          </button>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1 text-success">
            <Plus size={11} />
            {stats.add}
          </span>
          <span className="flex items-center gap-1 text-danger">
            <Minus size={11} />
            {stats.del}
          </span>
          <span className="flex items-center gap-1 text-muted">
            <Equal size={11} />
            {stats.eq}
          </span>
        </div>
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border border-line">
        {view === 'unified' ? (
          <div className="font-mono text-xs leading-relaxed">
            {rows.length === 0 ? (
              <div className="px-3 py-4 text-center text-muted">{t('tools.diff.empty')}</div>
            ) : (
              rows.map((r, i) => (
                <div
                  key={i}
                  className={
                    r.kind === 'add'
                      ? 'bg-success/10 text-success'
                      : r.kind === 'del'
                        ? 'bg-danger/10 text-danger'
                        : r.kind === 'mod'
                          ? 'bg-warning/10'
                          : ''
                  }
                >
                  <span className="inline-block w-6 select-none text-center text-muted">
                    {r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre-wrap break-all">
                    {r.kind === 'mod' ? `${r.left ?? ''} → ${r.right ?? ''}` : r.kind === 'add' ? r.right : r.left}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 font-mono text-xs leading-relaxed">
            {rows.length === 0 ? (
              <div className="col-span-2 px-3 py-4 text-center text-muted">{t('tools.diff.empty')}</div>
            ) : (
              rows.flatMap((r, i) => {
                const cell = (text: string | undefined, kind: 'eq' | 'add' | 'del' | 'mod' | 'pad', side: 'L' | 'R') => {
                  const cls =
                    kind === 'add'
                      ? 'bg-success/10 text-success'
                      : kind === 'del'
                        ? 'bg-danger/10 text-danger'
                        : kind === 'pad'
                          ? 'bg-hover text-muted/40'
                          : '';
                  return (
                    <div key={`${i}-${side}`} className={`flex border-r border-line last:border-r-0 ${cls}`}>
                      <span className="inline-block w-6 select-none text-center text-muted">
                        {kind === 'add' ? '+' : kind === 'del' ? '-' : ' '}
                      </span>
                      <span className="whitespace-pre-wrap break-all">{text ?? ' '}</span>
                    </div>
                  );
                };
                if (r.kind === 'eq') {
                  return [cell(r.left, 'eq', 'L'), cell(r.right, 'eq', 'R')];
                }
                if (r.kind === 'add') {
                  return [cell('', 'pad', 'L'), cell(r.right, 'add', 'R')];
                }
                if (r.kind === 'del') {
                  return [cell(r.left, 'del', 'L'), cell('', 'pad', 'R')];
                }
                return [cell(r.left, 'del', 'L'), cell(r.right, 'add', 'R')];
              })
            )}
          </div>
        )}
      </div>

      {unified && (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">{t('tools.output')}</span>
            <CopyButton text={unified} />
          </div>
          <pre className="max-h-[140px] overflow-auto rounded-lg border border-line bg-hover px-2.5 py-2 font-mono text-xs whitespace-pre-wrap break-all">
            {unified}
          </pre>
        </div>
      )}
    </ToolShell>
  );
}
