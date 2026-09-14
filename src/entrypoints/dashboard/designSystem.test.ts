/**
 * Design-system guard — no styling is allowed to go silently missing.
 *
 * Tailwind only emits CSS for class names it recognises. Anything else is
 * dropped without a word: the element renders as if it carried no classes at
 * all — no fill, no border, no hover, no focus ring, no cursor — and neither
 * TypeScript nor the build says a thing. That is exactly how `btn-primary` /
 * `btn-ghost` (the real names are `primary-btn` / `ghost-btn`) spread through
 * the entire media module, where every button was invisible as a button while
 * four separate "redesign" passes happily re-emitted the same dead names.
 *
 * So: compile the project's own stylesheets with every class name the JSX
 * actually uses, and fail on any that resolve to nothing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../..', import.meta.url));
const PROJECT_ROOT = path.resolve(SRC_DIR, '..');
const CSS_ENTRIES = [
  path.join(SRC_DIR, 'entrypoints/dashboard/app.css'),
  path.join(SRC_DIR, 'entrypoints/dashboard/markdown/markdown.css'),
];

/** Resolve an `@import` the way Vite does: a bare specifier names a package's
 *  style entry, anything else is relative to the importing file. */
function resolveStylesheet(id: string, base: string): string {
  if (id.startsWith('.') || path.isAbsolute(id)) return path.resolve(base, id);
  return path.join(PROJECT_ROOT, 'node_modules', id, 'index.css');
}

/** A token that cannot appear in a class list (expression fragment, string
 *  delimiter, comparison …) — used to skip non-class text caught by the
 *  className scan. Tailwind syntax itself (`:`, `[`, `]`, `!`, `/`, `%`,
 *  `(`, `)`) must stay allowed. */
const NOT_A_CLASS = /['"{}=?;<>|$`,\s]/;

/** Characters/operators that can legally introduce a class-list literal:
 *  branches of a ternary, arguments to `cn(...)`, `&&` guards, the start of
 *  the expression. A literal after `===`, `.` or a bare identifier is a
 *  VALUE (`view === 'request'`), never a class list. */
const CLASS_LITERAL_PRECEDERS = new Set(['', '{', '(', ',', '?', ':', '&&', '||', '??', '=>', '+']);

/** Walk a className expression collecting the class-list literals in it.
 *  Template literals are split into static text and `${…}` interpolations,
 *  so `` `base ${view === 'markdown' ? 'font-bold' : 'text-muted'}` `` yields
 *  `base`, `font-bold` and `text-muted` — and correctly ignores the compared
 *  value `'markdown'`, which is data, not styling. */
function collectLiterals(expression: string, push: (value: string) => void): void {
  let i = 0;
  let prev = '';
  while (i < expression.length) {
    const ch = expression[i]!;
    if (ch === '"' || ch === "'") {
      const from = i + 1;
      i++;
      while (i < expression.length && expression[i] !== ch) i += expression[i] === '\\' ? 2 : 1;
      i++;
      if (CLASS_LITERAL_PRECEDERS.has(prev)) push(expression.slice(from, i - 1));
      prev = ch;
      continue;
    }
    if (ch === '`') {
      i++;
      const text: string[] = [];
      while (i < expression.length && expression[i] !== '`') {
        if (expression[i] === '\\') {
          text.push(expression[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (expression[i] === '$' && expression[i + 1] === '{') {
          let depth = 1;
          let j = i + 2;
          const from = j;
          while (j < expression.length && depth > 0) {
            const inner = expression[j]!;
            if (inner === '{') depth++;
            else if (inner === '}') depth--;
            else if (inner === '"' || inner === "'" || inner === '`') {
              const quote = inner;
              j++;
              while (j < expression.length && expression[j] !== quote) j += expression[j] === '\\' ? 2 : 1;
            }
            j++;
          }
          collectLiterals(expression.slice(from, j - 1), push);
          text.push(' ');
          i = j;
          continue;
        }
        text.push(expression[i]!);
        i++;
      }
      i++;
      push(text.join(''));
      prev = '`';
      continue;
    }
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Pull every class-list literal out of `className` attributes, including the
 *  ones nested inside `{cond ? … : …}` and template literals. */
function classLiteralsIn(source: string): { value: string; index: number }[] {
  const found: { value: string; index: number }[] = [];
  const attr = /className\s*=\s*/g;
  let match: RegExpExecArray | null;
  while ((match = attr.exec(source))) {
    let i = attr.lastIndex;
    const start = i;
    const head = source[i];
    if (head === '"' || head === "'") {
      i++;
      const from = i;
      while (i < source.length && source[i] !== head) i++;
      found.push({ value: source.slice(from, i), index: start });
      continue;
    }
    if (head !== '{') continue;
    // Balanced scan that skips over any string it meets, so braces and
    // backticks inside the expression cannot end it early.
    let depth = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        i++;
        while (i < source.length && source[i] !== ch) i += source[i] === '\\' ? 2 : 1;
        i++;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        i++;
        break;
      }
      i++;
    }
    collectLiterals(source.slice(start, i), (value) => found.push({ value, index: start }));
  }
  return found;
}

/** Class names present as selectors in a chunk of CSS. Unescapes Tailwind's
 *  selector escaping so `text-\[13px\]` comes back as `text-[13px]`, and
 *  splits compound selectors (`.app-scroller.sb-hairline`) into both names.
 *  An escaped dot (`text-[1\.5rem]`) stays inside its class name. */
function classSelectorsIn(css: string): Set<string> {
  const classes = new Set<string>();
  for (const match of css.matchAll(/\.((?:\\.|[^\s,{:>+~()"'[\].])+)/g)) {
    const name = match[1];
    if (name) classes.add(name.replace(/\\(.)/g, '$1'));
  }
  return classes;
}

const used = walk(SRC_DIR)
  .flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return classLiteralsIn(source).flatMap(({ value, index }) => {
      const line = source.slice(0, index).split('\n').length;
      return value
        .split(/\s+/)
        .filter((token) => token && !token.includes('${') && !NOT_A_CLASS.test(token))
        .map((token) => ({ token, where: `${path.relative(SRC_DIR, file)}:${line}` }));
    });
  })
  .filter(({ token }) => !token.startsWith('http') && !token.includes('://'));

describe('design system', () => {
  it('every class name the UI uses can actually produce CSS', async () => {
    const known = new Set<string>();
    for (const entry of CSS_ENTRIES) {
      const css = readFileSync(entry, 'utf8');
      const compiler = await compile(css, {
        base: path.dirname(entry),
        loadStylesheet: async (id, base) => {
          const file = resolveStylesheet(id, base);
          return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
        },
      });
      for (const name of classSelectorsIn(compiler.build([...new Set(used.map(({ token }) => token))]))) {
        known.add(name);
      }
    }

    const missing = used.filter(({ token }) => !known.has(token));
    const report = [...new Set(missing.map(({ token, where }) => `${token}  (${where})`))].sort();
    expect(
      report,
      'These class names produce no CSS at all — a typo here means the element silently renders unstyled.\n' +
        'If a name is a new design-system class, define it in app.css; otherwise use an existing one.',
    ).toEqual([]);
  });
});
