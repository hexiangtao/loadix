/**
 * Visual identity for OG cards: derive a deterministic theme from the
 * document itself so different documents get recognisably different cards.
 *
 * - Code documents get a per-language hue (API docs vs SQL vs shell look
 *   different at a glance) plus a monospace "code card" layout hint.
 * - Prose documents pick a hue from a simple content hash so the same
 *   document always produces the same card, and different documents vary.
 */

const PALETTES = [
  { name: 'blue', bg0: '#0f172a', bg1: '#123b67', accent: '#0a84ff', soft: '#93c5fd', tint: '#0a84ff' },
  { name: 'violet', bg0: '#17132b', bg1: '#3b2166', accent: '#8b5cf6', soft: '#ddd6fe', tint: '#8b5cf6' },
  { name: 'teal', bg0: '#04201d', bg1: '#0b4f47', accent: '#2dd4bf', soft: '#99f6e4', tint: '#2dd4bf' },
  { name: 'amber', bg0: '#2a1a05', bg1: '#6d4408', accent: '#f59e0b', soft: '#fde68a', tint: '#f59e0b' },
  { name: 'rose', bg0: '#2b0d18', bg1: '#701a37', accent: '#fb7185', soft: '#fecdd3', tint: '#fb7185' },
  { name: 'green', bg0: '#0a2413', bg1: '#14532d', accent: '#30d158', soft: '#bbf7d0', tint: '#30d158' },
];

/** Per-language hues for code documents (index into PALETTES). */
const CODE_PALETTE = {
  js: 0, javascript: 0, ts: 0, typescript: 0, json: 0,
  python: 3, py: 3, sql: 3, bash: 3, sh: 3, shell: 3,
  html: 1, css: 1, vue: 1, svelte: 1,
  go: 2, rust: 2, c: 2, cpp: 2, java: 2, kotlin: 2, swift: 2,
  yaml: 4, toml: 4, ruby: 4, php: 4,
  diff: 5, dockerfile: 5, makefile: 5,
};

/** Fenced code fence info-strings, e.g. ```ts */
export function detectCodeLanguage(source) {
  const fence = /^\s*```\s*([A-Za-z0-9_+-]{1,20})\s*$/m.exec(source);
  return fence ? fence[1].toLowerCase() : null;
}

export function looksLikeCode(source) {
  if (detectCodeLanguage(source)) return true;
  // Indented-heavy + symbol-dense documents read as code even without fences
  const lines = source.split('\n').filter((l) => l.trim());
  if (lines.length < 4) return false;
  const codeish = lines.filter((l) => /[{};=>]|^\s{4,}\S|^\s*(function|const|let|var|import|def|class)\b/.test(l)).length;
  return codeish / lines.length > 0.5;
}

/** Deterministic 32-bit FNV-1a hash. */
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * @returns {{ palette: object, isCode: boolean, language: string|null }}
 */
export function cardTheme(source) {
  const language = detectCodeLanguage(source);
  const isCode = Boolean(language) || looksLikeCode(source);

  let palette;
  if (language && CODE_PALETTE[language] != null) {
    palette = PALETTES[CODE_PALETTE[language]];
  } else {
    palette = PALETTES[hash32(source) % PALETTES.length];
  }
  return { palette, isCode, language };
}
