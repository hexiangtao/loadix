import { useState } from 'react';

/**
 * Collapsible tree view for arbitrary JSON values.
 *
 * Large siblings are windowed (first N rendered, "show more" reveals the
 * rest) so a 10k-element array does not melt the DOM. Every node copies its
 * JSONPath — the same path you would paste into the Query tab.
 */

const PREVIEW_CHILDREN = 50;
const PREVIEW_STRING = 200;

interface JsonTreeViewProps {
  value: unknown;
  initialDepth?: number;
}

export function JsonTreeView({ value, initialDepth = 2 }: JsonTreeViewProps) {
  return (
    <div className="field mt-1.5 min-h-[140px] w-full flex-1 overflow-auto font-mono text-sm">
      <Node name="$" value={value} path="$" depth={0} initialDepth={initialDepth} />
    </div>
  );
}

function Node({ name, value, path, depth, initialDepth }: { name: string; value: unknown; path: string; depth: number; initialDepth: number }) {
  const [open, setOpen] = useState(depth < initialDepth);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);

  const isObj = value !== null && typeof value === 'object';
  const entries: [string, unknown][] = isObj
    ? Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(value as Record<string, unknown>)
    : [];

  const copyPath = () => {
    void navigator.clipboard.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  if (!isObj) {
    return (
      <div className="flex items-baseline gap-1.5 py-px">
        <span className="text-primary">{name}</span>
        <span className="text-muted">:</span>
        <ScalarValue value={value} />
        <button
          onClick={copyPath}
          title={copied ? '✓' : path}
          className="ml-1 shrink-0 rounded px-1 text-[10px] text-muted opacity-0 transition-opacity duration-150 hover:bg-hover hover:text-ink group-hover:opacity-100"
        >
          {copied ? '✓' : '⧉'}
        </button>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const bracket = isArray ? ['[', ']'] as const : ['{', '}'] as const;
  const visible = showAll ? entries : entries.slice(0, PREVIEW_CHILDREN);

  return (
    <div className="py-px">
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-left hover:text-primary">
        <span className="w-3 text-muted">{open ? '▾' : '▸'}</span>
        <span className="text-primary">{name}</span>
        <span className="text-muted">{!open && `${bracket[0]}${entries.length}${bracket[1]}`}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-line/60 pl-3">
          {visible.map(([k, v]) => (
            <Node key={k} name={k} value={v} path={childPath(path, k, isArray)} depth={depth + 1} initialDepth={initialDepth} />
          ))}
          {entries.length > PREVIEW_CHILDREN && !showAll && (
            <button onClick={() => setShowAll(true)} className="text-xs text-primary hover:underline">
              … {entries.length - PREVIEW_CHILDREN} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function childPath(parent: string, key: string, isArray: boolean): string {
  return isArray ? `${parent}[${key}]` : `${parent}.${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)}`;
}

function ScalarValue({ value }: { value: unknown }) {
  if (value === null) return <span className="italic text-muted">null</span>;
  if (typeof value === 'string') {
    const long = value.length > PREVIEW_STRING;
    return (
      <span className="text-success">
        "{long ? `${value.slice(0, PREVIEW_STRING)}…` : value}"
        {long && <span className="text-[10px] text-muted"> ({value.length})</span>}
      </span>
    );
  }
  return <span className="text-warning">{String(value)}</span>;
}
