import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Plus, Trash2 } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

interface UrlParserToolProps {
  initialPayload?: string;
}

interface QueryRow {
  key: string;
  value: string;
}

const SAMPLES = [
  'https://api.example.com/v1/orders?status=paid&limit=20#results',
  'https://user:pass@httpbin.org/basic-auth/user/pass?show_env=1',
  'https://www.google.com/search?q=hello+world&hl=zh-CN',
  'http://localhost:5173/#/dashboard?tab=loadtest',
];

function safeParse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function parseQuery(qs: string): QueryRow[] {
  if (!qs) return [];
  return [...new URLSearchParams(qs).entries()].map(([key, value]) => ({ key, value }));
}

function buildQuery(rows: QueryRow[]): string {
  const usp = new URLSearchParams();
  for (const { key, value } of rows) {
    if (key) usp.append(key, value);
  }
  return usp.toString();
}

export function UrlParserTool({ initialPayload }: UrlParserToolProps) {
  const { t } = useTranslation();
  const [raw, setRaw] = usePersistedState('urlparser.input', initialPayload ?? SAMPLES[0]!);

  // Whenever the raw URL changes, re-derive the query table from it.
  const parsed = useMemo(() => safeParse(raw), [raw]);
  const [rows, setRows] = useState<QueryRow[]>(() => (parsed ? parseQuery(parsed.search.slice(1)) : []));
  useEffect(() => {
    if (parsed) setRows(parseQuery(parsed.search.slice(1)));
  }, [parsed]);

  // Edit a query row and push the rebuilt URL back into the raw input.
  const updateRow = (idx: number, patch: Partial<QueryRow>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setRows(next);
    if (parsed) {
      const qs = buildQuery(next);
      const next2 = new URL(raw);
      next2.search = qs;
      setRaw(next2.toString());
    }
  };

  const addRow = () => {
    const next = [...rows, { key: '', value: '' }];
    setRows(next);
  };

  const removeRow = (idx: number) => {
    const next = rows.filter((_, i) => i !== idx);
    setRows(next);
    if (parsed) {
      const qs = buildQuery(next);
      const next2 = new URL(raw);
      next2.search = qs;
      setRaw(next2.toString());
    }
  };

  // Component breakdown for the read-only "parts" panel.
  const parts = useMemo(() => {
    if (!parsed) return null;
    return {
      protocol: parsed.protocol,
      username: parsed.username,
      password: parsed.password,
      host: parsed.host,
      hostname: parsed.hostname,
      port: parsed.port,
      pathname: parsed.pathname,
      hash: parsed.hash,
    };
  }, [parsed]);

  return (
    <ToolShell icon={Globe} title={t('tools.urlparser.name')}>
      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.input')}</label>
      <div className="flex gap-2">
        <input
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="https://api.example.com/v1/orders?status=paid&limit=20"
          spellCheck={false}
        />
        {raw && <CopyButton text={raw} className="shrink-0" />}
      </div>

      {!parsed && raw.trim() && (
        <p className="mt-2 text-xs text-danger">{t('tools.urlparser.invalid')}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="text-xs text-muted">{t('tools.urlparser.samples')}:</span>
        {SAMPLES.map((s) => (
          <button
            key={s}
            onClick={() => setRaw(s)}
            className="max-w-[280px] truncate rounded-md border border-line px-2 py-0.5 font-mono text-[11px] text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
            title={s}
          >
            {s}
          </button>
        ))}
      </div>

      {parts && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            {([
              ['protocol', parts.protocol],
              ['host', parts.host],
              ['hostname', parts.hostname],
              ['port', parts.port || '—'],
              ['pathname', parts.pathname || '/'],
              ['hash', parts.hash || '—'],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-hover px-2.5 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {t(`tools.urlparser.${k}`)}
                </div>
                <div className="truncate font-mono text-xs">{v}</div>
              </div>
            ))}
            {(parts.username || parts.password) && (
              <div className="rounded-lg border border-line bg-hover px-2.5 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {t('tools.urlparser.credentials')}
                </div>
                <div className="truncate font-mono text-xs">
                  {parts.username}
                  {parts.password ? `:${parts.password}` : ''}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted">
                {t('tools.urlparser.queryParams')} ({rows.length})
              </span>
              <button
                onClick={addRow}
                className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
              >
                <Plus size={11} />
                {t('tools.urlparser.add')}
              </button>
            </div>
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-hover text-[10px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="w-[40%] px-2 py-1 text-left font-semibold">Key</th>
                    <th className="px-2 py-1 text-left font-semibold">Value</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-2 py-2 text-center text-xs text-muted">
                        {t('tools.urlparser.noParams')}
                      </td>
                    </tr>
                  )}
                  {rows.map((r, idx) => (
                    <tr key={idx} className="border-t border-line">
                      <td className="px-1.5 py-1">
                        <input
                          value={r.key}
                          onChange={(e) => updateRow(idx, { key: e.target.value })}
                          className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-xs outline-none transition-colors duration-150 focus:border-primary"
                          spellCheck={false}
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <input
                          value={r.value}
                          onChange={(e) => updateRow(idx, { value: e.target.value })}
                          className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-xs outline-none transition-colors duration-150 focus:border-primary"
                          spellCheck={false}
                        />
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button
                          onClick={() => removeRow(idx)}
                          className="rounded p-0.5 text-muted transition-colors duration-150 hover:bg-danger/10 hover:text-danger"
                          title={t('tools.urlparser.remove')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </ToolShell>
  );
}
