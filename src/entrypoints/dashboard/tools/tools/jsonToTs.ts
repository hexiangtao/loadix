/**
 * JSON → TypeScript type generation.
 *
 * A deliberately small inference pass (no schema round-trip): values are
 * inferred, arrays collapse into unions of element shapes, and repeated
 * object "families" merge optional keys so real-world API payloads produce
 * readable interfaces instead of one interface per row.
 */

export interface JsonToTsOptions {
  rootName?: string;
  /** Use `interface` (default) or `type` aliases. */
  style?: 'interface' | 'type';
}

type Json = unknown;

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Merge two object shapes; keys missing on one side become optional. */
function mergeObjects(a: Record<string, Json>, b: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k in out) {
      const av = out[k];
      if (isPlainObject(av) && isPlainObject(v)) out[k] = mergeObjects(av, v);
      // otherwise keep the first; the type becomes a union below via anyOf
    } else {
      out[k] = v;
    }
  }
  return out;
}

function scalarType(v: Json): string | null {
  switch (typeof v) {
    case 'string':
      return 'string';
    case 'number':
      return Number.isInteger(v) ? 'number' : 'number';
    case 'boolean':
      return 'boolean';
    case 'bigint':
      return 'bigint';
    default:
      return null;
  }
}

/** Infer a TS type string for a value. `typesByPath` collects interfaces. */
function infer(v: Json, name: string, interfaces: Map<string, string>, options: JsonToTsOptions): string {
  if (v === null) return 'null';
  const scalar = scalarType(v);
  if (scalar) return scalar;

  if (Array.isArray(v)) {
    if (v.length === 0) return 'unknown[]';
    const members = new Set<string>();
    let merged: Record<string, Json> | null = null;
    for (const item of v) {
      if (isPlainObject(item)) {
        merged = merged ? mergeObjects(merged, item) : item;
      } else {
        members.add(infer(item, singular(name), interfaces, options));
      }
    }
    if (merged) members.add(infer(merged, singular(name), interfaces, options));
    const union = [...members].sort().join(' | ');
    return union.includes(' | ') ? `(${union})[]` : `${union}[]`;
  }

  // Plain object → named interface
  const ifaceName = toPascalCase(name) || 'Root';
  let finalName = ifaceName;
  let n = 2;
  while (interfaces.has(finalName) && interfaces.get(finalName) !== '__pending__') {
    finalName = `${ifaceName}${n++}`;
  }
  interfaces.set(finalName, '__pending__');

  const lines: string[] = [];
  for (const [k, val] of Object.entries(v ?? {})) {
    const tsKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
    lines.push(`  ${tsKey}: ${infer(val, k, interfaces, options)};`);
  }
  interfaces.set(finalName, lines.join('\n'));
  return finalName;
}

function singular(name: string): string {
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
  if (name.endsWith('ses')) return name.slice(0, -2);
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return `${name}Item`;
}

function toPascalCase(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''));
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function jsonToTs(value: Json, options: JsonToTsOptions = {}): string {
  const rootName = options.rootName ?? 'Root';
  const interfaces = new Map<string, string>();
  const rootType = infer(value, rootName, interfaces, options);

  // Scalars / arrays at the root don't produce interfaces.
  const decls = [...interfaces.entries()].filter(([, body]) => body !== '__pending__');
  if (decls.length === 0) return `export type ${toPascalCase(rootName)} = ${rootType};`;

  const kw = options.style === 'type' ? 'type' : 'interface';
  const body = decls.map(([name, fields]) => {
    if (fields === '') return `export ${kw} ${name} {}`;
    if (kw === 'type') return `export type ${name} = {\n${fields}\n};`;
    return `export interface ${name} {\n${fields}\n}`;
  });
  return body.join('\n\n');
}
