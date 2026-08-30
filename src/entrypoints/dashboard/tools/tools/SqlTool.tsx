import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

interface SqlToolProps {
  initialPayload?: string;
}

/**
 * Lightweight SQL formatter: uppercases keywords, normalizes commas and
 * whitespace, and breaks major clauses onto their own lines. Purely
 * token-based (no SQL parser), so it works for any dialect reasonably well.
 */
function formatSql(sql: string, uppercase: boolean): string {
  const KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'JOIN', 'LEFT JOIN',
    'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'FULL JOIN', 'ON', 'AND', 'OR', 'NOT',
    'IN', 'AS', 'UNION', 'UNION ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  ];

  let out = sql.replace(/\s+/g, ' ').trim();

  // Protect string literals from keyword replacement.
  const strings: string[] = [];
  out = out.replace(/'(?:[^']|'')*'/g, (m) => {
    strings.push(m);
    return `\u0000${strings.length - 1}\u0000`;
  });

  for (const kw of KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/ /g, '\\s+')}\\b`, 'gi');
    out = out.replace(re, uppercase ? kw : kw.toLowerCase());
  }

  // Break major clauses onto separate lines.
  out = out
    .replace(/\s*\bFROM\b\s*/gi, '\nFROM ')
    .replace(/\s*\bWHERE\b\s*/gi, '\nWHERE ')
    .replace(/\s*\bGROUP BY\b\s*/gi, '\nGROUP BY ')
    .replace(/\s*\bORDER BY\b\s*/gi, '\nORDER BY ')
    .replace(/\s*\bHAVING\b\s*/gi, '\nHAVING ')
    .replace(/\s*\bLIMIT\b\s*/gi, '\nLIMIT ')
    .replace(/\s*\bOFFSET\b\s*/gi, '\nOFFSET ')
    .replace(/\s*\bLEFT JOIN\b\s*/gi, '\nLEFT JOIN ')
    .replace(/\s*\bRIGHT JOIN\b\s*/gi, '\nRIGHT JOIN ')
    .replace(/\s*\bINNER JOIN\b\s*/gi, '\nINNER JOIN ')
    .replace(/\s*\bJOIN\b\s*/gi, '\nJOIN ')
    .replace(/,\s*/g, ', ');

  // Restore string literals.
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => strings[Number(i)] ?? '');

  return out;
}

export function SqlTool({ initialPayload }: SqlToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('sql.input', initialPayload ?? '');
  const [uppercase, setUppercase] = useState(true);

  const formatted = useMemo(() => {
    if (!input.trim()) return '';
    try {
      return formatSql(input, uppercase);
    } catch {
      return '';
    }
  }, [input, uppercase]);

  return (
    <ToolShell icon={Database} title={t('tools.sql.name')}>
      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.input')}</label>
      <textarea
        autoFocus
        className="min-h-[120px] w-full flex-1 resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="select id,name from users where age>18 order by id limit 10"
      />

      <div className="mt-4 flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs font-semibold text-muted">
          <input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} />
          {t('tools.sql.uppercase')}
        </label>
        {formatted && <CopyButton text={formatted} />}
      </div>
      <pre className="mt-1.5 min-h-[120px] w-full flex-1 overflow-auto rounded-lg border border-line bg-hover px-2.5 py-2 font-mono text-sm">
        {formatted}
      </pre>
    </ToolShell>
  );
}
