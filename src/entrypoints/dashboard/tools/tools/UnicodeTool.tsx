import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Type } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

type Mode = 'encode' | 'decode';
/** What gets escaped. */
type Scope = 'all' | 'nonAscii' | 'control';

/**
 * Map a codepoint → short, human-friendly category. Used by the inspector
 * panel so users can tell at a glance whether a glyph is a letter, number,
 * punctuation, or a control / format character.
 */
const CATEGORY_NAMES: Record<string, string> = {
  Lu: 'Letter, uppercase',
  Ll: 'Letter, lowercase',
  Lt: 'Letter, titlecase',
  Lm: 'Letter, modifier',
  Lo: 'Letter, other',
  Mn: 'Mark, nonspacing',
  Mc: 'Mark, spacing combining',
  Me: 'Mark, enclosing',
  Nd: 'Number, decimal digit',
  Nl: 'Number, letter',
  No: 'Number, other',
  Pc: 'Punctuation, connector',
  Pd: 'Punctuation, dash',
  Ps: 'Punctuation, open',
  Pe: 'Punctuation, close',
  Pi: 'Punctuation, initial quote',
  Pf: 'Punctuation, final quote',
  Po: 'Punctuation, other',
  Sm: 'Symbol, math',
  Sc: 'Symbol, currency',
  Sk: 'Symbol, modifier',
  So: 'Symbol, other',
  Zs: 'Separator, space',
  Zl: 'Separator, line',
  Zp: 'Separator, paragraph',
  Cc: 'Control',
  Cf: 'Format',
  Cs: 'Surrogate',
  Co: 'Private use',
  Cn: 'Unassigned',
};

interface UnicodeToolProps {
  initialPayload?: string;
}

/** Convert a single code point to a UTF-16 escape sequence (handles surrogates). */
function escapeOne(cp: number): string {
  if (cp < 0x10000) {
    return `\\u${cp.toString(16).padStart(4, '0')}`;
  }
  // Surrogate pair for code points above BMP.
  const offset = cp - 0x10000;
  const high = 0xd800 + (offset >> 10);
  const low = 0xdc00 + (offset & 0x3ff);
  return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`;
}

/**
 * Decide whether a code point should be escaped, given the current scope.
 * "all"     — escape everything (handy for fully portable string literals).
 * "nonAscii"— escape anything outside the printable ASCII range (0x20–0x7e).
 * "control" — escape only control characters + non-ASCII.
 */
function shouldEscape(cp: number, scope: Scope): boolean {
  if (scope === 'all') return true;
  if (scope === 'nonAscii') return cp < 0x20 || cp > 0x7e;
  // 'control': only escape true control characters (Cc) and outside ASCII.
  const cat = characterCategory(cp);
  return cp < 0x20 || cp === 0x7f || (cat === 'Cc' && cp >= 0x80);
}

function escapeText(text: string, scope: Scope): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out += shouldEscape(cp, scope) ? escapeOne(cp) : ch;
  }
  return out;
}

/**
 * Decode a stream of \uXXXX and \u{XXXXX} escape sequences. Tolerates
 * literal `\u` (backslash + 'u') and missing leading backslash. Any
 * unrecognised sequence is left as-is.
 */
function decodeEscapes(text: string): { value: string; error: string } {
  // Match either \uXXXX (4 hex) or \u{1..5 hex}.
  const re = /\\u(?:\{([0-9a-fA-F]{1,5})\}|([0-9a-fA-F]{4}))/g;
  const errors: string[] = [];
  const out = text.replace(re, (_match, brace: string | undefined, flat: string | undefined) => {
    const hex = brace ?? flat ?? '';
    const cp = parseInt(hex, 16);
    if (Number.isNaN(cp) || cp < 0 || cp > 0x10ffff) {
      errors.push(`\\u${hex}`);
      return _match;
    }
    try {
      return String.fromCodePoint(cp);
    } catch {
      errors.push(`\\u${hex}`);
      return _match;
    }
  });
  return { value: out, error: errors.length ? `Invalid escape: ${errors.join(', ')}` : '' };
}

/** Tiny category lookup — uses the first character of the regex's Unicode data. */
function characterCategory(cp: number): string {
  if (cp <= 0x1f) return 'Cc';
  if (cp === 0x7f) return 'Cc';
  if (cp === 0x20) return 'Zs';
  // Use Intl.Segmenter? No — for a fast look-up we just match common blocks.
  if (cp >= 0x30 && cp <= 0x39) return 'Nd';
  if (cp >= 0x41 && cp <= 0x5a) return 'Lu';
  if (cp >= 0x61 && cp <= 0x7a) return 'Ll';
  if (cp >= 0x80 && cp <= 0x9f) return 'Cc';
  if (cp >= 0xa0 && cp <= 0xbf) return 'Po';
  if (cp >= 0xc0 && cp <= 0xff) return 'Lu';
  // For the rest, defer to a regex over the RegExp Unicode property escapes.
  try {
    const ch = String.fromCodePoint(cp);
    if (/\p{Mark}/u.test(ch)) return 'Mn';
    if (/\p{Number}/u.test(ch)) return 'Nd';
    if (/\p{Punctuation}/u.test(ch)) return 'Po';
    if (/\p{Symbol}/u.test(ch)) return 'So';
    if (/\p{Separator}/u.test(ch)) return 'Zs';
    if (/\p{Format}/u.test(ch)) return 'Cf';
    if (/\p{Letter}/u.test(ch)) return 'Lo';
  } catch {
    /* fall through */
  }
  return 'Cn';
}

/** Bytes that a code point occupies when encoded as UTF-8. */
function utf8Bytes(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/** Code units that a code point occupies when encoded as UTF-16. */
function utf16Units(cp: number): number {
  return cp < 0x10000 ? 1 : 2;
}

export function UnicodeTool({ initialPayload }: UnicodeToolProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('encode');
  const [scope, setScope] = useState<Scope>('nonAscii');
  const [input, setInput] = usePersistedState('unicode.input', initialPayload ?? 'Hello, 世界! 😀');

  const encoded = useMemo(() => {
    if (!input) return { value: '', error: '' };
    return { value: escapeText(input, scope), error: '' };
  }, [input, scope]);

  const decoded = useMemo(() => {
    if (!input) return { value: '', error: '' };
    return decodeEscapes(input);
  }, [input]);

  const output = mode === 'encode' ? encoded : decoded;
  const error = output.error;

  /** Distinct code points in the source text (for the inspector strip). */
  const codepoints = useMemo(() => {
    if (!input) return [] as { char: string; cp: number; cat: string; utf8: number; utf16: number }[];
    const seen = new Set<number>();
    const items: { char: string; cp: number; cat: string; utf8: number; utf16: number }[] = [];
    for (const ch of input) {
      const cp = ch.codePointAt(0)!;
      if (seen.has(cp)) continue;
      seen.add(cp);
      const cat = characterCategory(cp);
      items.push({ char: ch, cp, cat, utf8: utf8Bytes(cp), utf16: utf16Units(cp) });
    }
    return items.slice(0, 24);
  }, [input]);

  return (
    <ToolShell icon={Type} title={t('tools.unicode.name')}>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(['encode', 'decode'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-3.5 py-2 text-sm transition-colors duration-150 ${
              mode === m ? 'bg-primary/10 font-semibold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {t(`tools.unicode.${m}`)}
          </button>
        ))}

        {mode === 'encode' && (
          <>
            <span className="mx-1 h-6 w-px bg-line" />
            {(['nonAscii', 'control', 'all'] as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`rounded-lg px-2.5 py-2 text-xs transition-colors duration-150 ${
                  scope === s ? 'bg-hover font-semibold text-ink' : 'text-muted hover:text-ink'
                }`}
                title={t(`tools.unicode.scope_${s}_hint`)}
              >
                {t(`tools.unicode.scope_${s}`)}
              </button>
            ))}
          </>
        )}
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.input')}</label>
      <textarea
        autoFocus
        className="field min-h-[120px] w-full flex-1 resize-y font-mono text-sm"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={mode === 'encode' ? 'Hello, 世界! 😀' : '\\u0048\\u0065\\u006c\\u006c\\u006f'}
      />

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <label className="text-xs font-semibold text-muted">{t('tools.output')}</label>
        {output.value && <CopyButton text={output.value} />}
      </div>
      <div className="field mt-1.5 min-h-[120px] w-full flex-1 break-all bg-hover font-mono text-sm whitespace-pre-wrap">
        {output.value || ''}
      </div>

      {mode === 'encode' && codepoints.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t('tools.unicode.codepoints')}
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {codepoints.map(({ char, cp, cat, utf8, utf16 }) => (
              <div key={cp} className="flex items-center gap-2 rounded-lg border border-line bg-hover px-2.5 py-1.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-panel font-mono text-sm">
                  {char}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate font-mono text-[11px] text-ink">U+{cp.toString(16).toUpperCase().padStart(4, '0')}</div>
                  <div className="truncate text-[10px] text-muted">
                    {CATEGORY_NAMES[cat] ?? cat} · {utf8}B / {utf16}U
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </ToolShell>
  );
}
