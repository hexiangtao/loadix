/**
 * Collapsible JSON tree for the response "Pretty" view.
 *
 * Deliberately tiny and dependency-free: objects/arrays render as
 * indented rows with expand/collapse chevrons, primitives are coloured
 * with the app's semantic tokens, and long strings truncate with a
 * native tooltip. The default expansion depth is capped so large
 * responses don't explode into thousands of DOM nodes.
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface JsonTreeProps {
  data: unknown;
  /** Depth expanded by default (0 = everything collapsed). */
  initialDepth?: number;
}

const DEFAULT_DEPTH = 2;

export function JsonTree({ data, initialDepth = DEFAULT_DEPTH }: JsonTreeProps) {
  if (data === null) return <span className="text-muted">null</span>;
  if (typeof data !== 'object') return <Primitive value={data} />;
  return <Branch data={data as Record<string, unknown> | unknown[]} depth={0} initialDepth={initialDepth} />;
}

function Branch({
  data,
  depth,
  initialDepth,
}: {
  data: Record<string, unknown> | unknown[];
  depth: number;
  initialDepth: number;
}) {
  const isArray = Array.isArray(data);
  const entries = isArray ? data.map((v, i) => [String(i), v] as [string, unknown]) : Object.entries(data);
  const [open, setOpen] = useState(() => depth < initialDepth);
  const toggle = () => setOpen((v) => !v);

  return (
    <div className="leading-relaxed">
      <button
        onClick={toggle}
        className="flex items-center gap-0.5 rounded px-0.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-ink"
      >
        <ChevronRight size={12} className={`shrink-0 transition-transform duration-100 ${open ? 'rotate-90' : ''}`} />
        <span className="text-ink/80">
          {isArray ? '[' : '{'}
          {!open && (
            <span className="text-muted">
              {entries.length === 0 ? '' : ` ${entries.length} item${entries.length === 1 ? '' : 's'}`}
            </span>
          )}
          {isArray ? ']' : '}'}
        </span>
      </button>

      {open && (
        <div className="ml-3 border-l border-line/60 pl-2">
          {entries.map(([key, value], idx) => (
            <div key={key} className="flex items-start gap-1">
              <span className="shrink-0 text-[13px] text-primary">{isArray ? '' : `${JSON.stringify(key)}: `}</span>
              <span className="min-w-0">
                {value !== null && typeof value === 'object' ? (
                  <Branch data={value as Record<string, unknown> | unknown[]} depth={depth + 1} initialDepth={initialDepth} />
                ) : (
                  <Primitive value={value} />
                )}
                <span className="text-muted">{idx < entries.length - 1 ? ',' : ''}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-[13px] text-muted">null</span>;
  if (typeof value === 'boolean') return <span className="text-[13px] text-warning">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-[13px] text-warning">{String(value)}</span>;
  const s = String(value);
  const truncated = s.length > 120 ? `${s.slice(0, 120)}…` : s;
  return (
    <span className="text-[13px] text-success" title={s.length > 120 ? s : undefined}>
      {JSON.stringify(truncated)}
    </span>
  );
}