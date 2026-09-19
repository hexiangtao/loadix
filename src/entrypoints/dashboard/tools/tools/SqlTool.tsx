import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database } from 'lucide-react';
import { format } from 'sql-formatter';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

interface SqlToolProps {
  initialPayload?: string;
}

/** Dialects offered in the picker. The library supports more; these cover
 *  the engines users actually paste from, keeping the UI scannable. */
const DIALECTS = [
  { id: 'sql', label: 'Standard SQL' },
  { id: 'mysql', label: 'MySQL' },
  { id: 'postgresql', label: 'PostgreSQL' },
  { id: 'sqlite', label: 'SQLite' },
  { id: 'mariadb', label: 'MariaDB' },
  { id: 'bigquery', label: 'BigQuery' },
  { id: 'clickhouse', label: 'ClickHouse' },
  { id: 'transactsql', label: 'SQL Server (T-SQL)' },
  { id: 'plsql', label: 'Oracle PL/SQL' },
  { id: 'hive', label: 'Apache Hive' },
  { id: 'spark', label: 'Spark' },
  { id: 'duckdb', label: 'DuckDB' },
] as const;

type DialectId = (typeof DIALECTS)[number]['id'];

export function SqlTool({ initialPayload }: SqlToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('sql.input', initialPayload ?? '');
  const [dialect, setDialect] = usePersistedState<DialectId>('sql.dialect', 'mysql');
  const [uppercase, setUppercase] = usePersistedState('sql.uppercase', true);
  const [indent, setIndent] = usePersistedState('sql.indent', 2);

  const result = useMemo(() => {
    if (!input.trim()) return { ok: true as const, text: '', error: '' };
    try {
      const text = format(input, {
        // The picker's ids are the library's own language names.
        language: dialect,
        keywordCase: uppercase ? 'upper' : 'preserve',
        tabWidth: indent,
      });
      return { ok: true as const, text, error: '' };
    } catch (e) {
      // A parse the real parser rejects (a truncated snippet, a stored-proc
      // fragment) is reported, not silently swallowed.
      return { ok: false as const, text: '', error: (e as Error).message.slice(0, 200) };
    }
  }, [input, dialect, uppercase, indent]);

  return (
    <ToolShell icon={Database} title={t('tools.sql.name')}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select
          value={dialect}
          onChange={(e) => setDialect(e.target.value as DialectId)}
          className="cursor-pointer rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none hover:border-primary focus:border-primary"
          aria-label="SQL dialect"
        >
          {DIALECTS.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>

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

        <label className="flex items-center gap-2 text-xs font-semibold text-muted">
          <input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} />
          {t('tools.sql.uppercase')}
        </label>
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.input')}</label>
      <textarea
        autoFocus
        className="field min-h-[120px] w-full flex-1 resize-y font-mono text-sm"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="select id,name from users where age>18 order by id limit 10"
      />

      {!result.ok && result.error && <p className="mt-2 text-xs text-danger">{result.error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <label className="text-xs font-semibold text-muted">{t('tools.sql.formatted')}</label>
        {result.text && <CopyButton text={result.text} />}
      </div>
      <pre className="field mt-1.5 min-h-[120px] w-full flex-1 overflow-auto font-mono text-sm">
        {result.text}
      </pre>
    </ToolShell>
  );
}
