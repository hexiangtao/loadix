/**
 * A small JSONPath evaluator covering the practical subset used by
 * response assertions and variable extraction:
 *
 *   $            root
 *   .key         property access
 *   ['key']      quoted property access (single or double quotes)
 *   .*           object wildcard (all values)
 *   [*]          array wildcard (all items)
 *   [0]          index access
 *   [0,2]        multiple indexes
 *   ..key        recursive descent (any depth)
 *
 * Anything else (filters `[?()]`, slices `[0:2]`, unions of paths) is
 * intentionally out of scope — this is for API testing ergonomics, not a
 * full spec implementation. Invalid paths return an empty result instead
 * of throwing, so a bad expression reads as "no match" rather than
 * crashing the run.
 */

type Token =
  | { kind: 'key'; value: string }
  | { kind: 'indexes'; values: number[] }
  | { kind: 'wildcard' }
  | { kind: 'recursive'; value: string };

/** Query `data` with a JSONPath expression; returns every matched value. */
export function queryJsonPath(data: unknown, path: string): unknown[] {
  if (!path || typeof path !== 'string') return [];
  const tokens = tokenize(path);
  if (tokens === null) return [];
  const results: unknown[] = [];
  walk([data], tokens, 0, results, [data]);
  return results;
}

/** The first match, or undefined when nothing matched. */
export function firstJsonPath<T = unknown>(data: unknown, path: string): T | undefined {
  return queryJsonPath(data, path)[0] as T | undefined;
}

function walk(
  values: unknown[],
  tokens: Token[],
  index: number,
  results: unknown[],
  /** Recursive descent needs the full stack of values seen so far. */
  stack: unknown[],
): void {
  if (index >= tokens.length) {
    for (const v of values) {
      if (v !== undefined && v !== null) results.push(v);
    }
    return;
  }
  const token = tokens[index];
  if (!token) return;
  if (token.kind === 'recursive') {
    // `..key` matches `key` at any depth: DFS the values' descendants,
    // collecting every node whose own key matches (each node visited once).
    const remaining = tokens.slice(index + 1);
    const visited = new Set<object>();
    const visit = (node: unknown, chain: unknown[]) => {
      if (node === null || typeof node !== 'object' || visited.has(node)) return;
      visited.add(node);
      const entries = Array.isArray(node)
        ? node.map((v, i) => [String(i), v] as [string, unknown])
        : Object.entries(node as Record<string, unknown>);
      for (const [key, value] of entries) {
        if (key === token.value) {
          if (remaining.length === 0) {
            if (value !== undefined && value !== null) results.push(value);
          } else {
            walk([value], remaining, 0, results, [...chain, value]);
          }
        }
        visit(value, [...chain, value]);
      }
    };
    for (const v of values) visit(v, [...stack, v]);
    return;
  }
  const next: unknown[] = [];
  for (const value of values) {
    if (value === null || typeof value !== 'object') continue;
    if (token.kind === 'key') {
      if (Array.isArray(value) && !Number.isNaN(Number(token.value)) && Number.isInteger(Number(token.value))) {
        // `.0` on an array behaves like `[0]` — forgiving of sloppy paths.
        const n = Number(token.value);
        if (n >= 0 && n < value.length) next.push(value[n]);
      } else if (Array.isArray(value)) {
        // Property access on an array: apply to every element (Postman's
        // jsonpath behaves this way for `items.name`).
        for (const item of value) {
          if (item !== null && typeof item === 'object' && !Array.isArray(item) && Object.prototype.hasOwnProperty.call(item, token.value)) {
            next.push((item as Record<string, unknown>)[token.value]);
          }
        }
      } else if (Object.prototype.hasOwnProperty.call(value, token.value)) {
        next.push((value as Record<string, unknown>)[token.value]);
      }
    } else if (token.kind === 'indexes') {
      if (Array.isArray(value)) {
        for (const n of token.values) {
          if (n >= 0 && n < value.length) next.push(value[n]);
        }
      }
    } else if (token.kind === 'wildcard') {
      if (Array.isArray(value)) next.push(...value);
      else next.push(...Object.values(value as Record<string, unknown>));
    }
  }
  walk(next, tokens, index + 1, results, [...stack, ...next]);
}

/** Tokenize a path like `$.store.books[0]['title']`; null when malformed. */
function tokenize(path: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const skipWs = () => {
    while (i < path.length && /\s/.test(path[i]!)) i++;
  };
  // Optional leading `$`, `$.key`, or `$..key` (recursive from the root)
  skipWs();
  if (path[i] === '$') {
    i++;
    if (path[i] === '.') {
      i++;
      if (path[i] === '.') {
        // `$..key` — recursive descent from the root
        i++;
        skipWs();
        const rootKey = readBareKey(path, i);
        if (rootKey === null) return null;
        i = rootKey.end;
        tokens.push({ kind: 'recursive', value: rootKey.value });
      } else {
        // `$.key` — the first key after the root
        skipWs();
        if (path[i] === '*') {
          tokens.push({ kind: 'wildcard' });
          i++;
        } else {
          const rootKey = readBareKey(path, i);
          if (rootKey === null) return null;
          i = rootKey.end;
          tokens.push({ kind: 'key', value: rootKey.value });
        }
      }
    }
  }
  while (i < path.length) {
    skipWs();
    const c = path[i];
    if (c === '.' && path[i + 1] === '.') {
      // Recursive descent: `..key`
      i += 2;
      skipWs();
      const key = readBareKey(path, i);
      if (key === null) return null;
      i = key.end;
      tokens.push({ kind: 'recursive', value: key.value });
    } else if (c === '.') {
      i++;
      skipWs();
      if (path[i] === '*') {
        tokens.push({ kind: 'wildcard' });
        i++;
      } else {
        const key = readBareKey(path, i);
        if (key === null) return null;
        i = key.end;
        tokens.push({ kind: 'key', value: key.value });
      }
    } else if (c === '[') {
      i++;
      skipWs();
      if (path[i] === '*') {
        tokens.push({ kind: 'wildcard' });
        i++;
        skipWs();
        if (path[i] !== ']') return null;
        i++;
      } else if (path[i] === "'" || path[i] === '"') {
        const quote = path[i]!;
        i++;
        let value = '';
        let closed = false;
        while (i < path.length) {
          if (path[i] === quote) {
            i++;
            closed = true;
            break;
          }
          value += path[i];
          i++;
        }
        if (!closed) return null;
        skipWs();
        if (path[i] !== ']') return null;
        i++;
        tokens.push({ kind: 'key', value });
      } else {
        // Index or index list: `[0]` / `[0,2]`
        const start = i;
        while (i < path.length && /[0-9,]/.test(path[i]!)) i++;
        const chunk = path.slice(start, i);
        skipWs();
        if (path[i] !== ']' || chunk.length === 0) return null;
        i++;
        const parts = chunk.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
        if (parts.length === 0) return null;
        for (const part of parts) {
          if (!/^\d+$/.test(part)) return null;
        }
        tokens.push({ kind: 'indexes', values: parts.map(Number) });
      }
    } else {
      return null;
    }
  }
  return tokens;
}

function readBareKey(path: string, start: number): { value: string; end: number } | null {
  if (start >= path.length || path[start] === '[' || path[start] === '.' || path[start] === '*') return null;
  let end = start;
  while (end < path.length && !['.', '[', '*'].includes(path[end]!)) end++;
  const value = path.slice(start, end);
  return value.length > 0 ? { value, end } : null;
}