import { useMemo, useState } from 'react';
import { JSONPath } from 'jsonpath-plus';
import { CopyButton } from '../CopyButton';

/**
 * JSONPath query console embedded in the JSON workbench. Uses jsonpath-plus
 * for full syntax (recursive descent, filters, functions) against the exact
 * value currently in the editor.
 */

export function JsonPathInput({ value }: { value: unknown }) {
  const [path, setPath] = useState('$..*');
  const [error, setError] = useState('');

  const results = useMemo(() => {
    setError('');
    try {
      return JSONPath({ path, json: value as object, wrap: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [path, value]);

  const rendered = useMemo(() => {
    if (results === null) return '';
    return results.map((r: unknown) => (typeof r === 'string' ? r : JSON.stringify(r, null, 2))).join('\n');
  }, [results]);

  return (
    <div className="mt-1.5 flex min-h-[140px] flex-1 flex-col gap-2">
      <input
        className="field w-full font-mono text-sm"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="$.store.books[?(@.price < 10)].title"
        spellCheck={false}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          {error ? <span className="text-danger">{error}</span> : `${results?.length ?? 0} matches`}
        </span>
        {rendered && <CopyButton text={rendered} />}
      </div>
      <pre className="field min-h-[100px] w-full flex-1 overflow-auto font-mono text-sm">{rendered || '—'}</pre>
    </div>
  );
}
