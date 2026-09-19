import { describe, expect, it } from 'vitest';
import { cardTheme, detectCodeLanguage, looksLikeCode } from './og-card-theme.mjs';
// Re-derive the palette names via a probe document (no direct export needed).
import { renderOgCard } from './share-core.mjs';
const PALETTES = [
  { name: 'blue' }, { name: 'violet' }, { name: 'teal' },
  { name: 'amber' }, { name: 'rose' }, { name: 'green' },
];

describe('detectCodeLanguage', () => {
  it('extracts the fence info-string', () => {
    expect(detectCodeLanguage('# T\n\n```ts\nconst a = 1\n```')).toBe('ts');
    expect(detectCodeLanguage('# T\n\n```python\nprint(1)\n```')).toBe('python');
  });

  it('returns null for prose documents', () => {
    expect(detectCodeLanguage('# Title\n\nJust a paragraph.')).toBeNull();
  });
});

describe('looksLikeCode', () => {
  it('detects symbol-dense unfenced code', () => {
    const code = ['function add(a, b) {', '  return a + b;', '}', 'const x = add(1, 2);'].join('\n');
    expect(looksLikeCode(code)).toBe(true);
  });

  it('does not flag prose', () => {
    expect(looksLikeCode('# Heading\n\nSome prose text.\n\nAnother paragraph here.')).toBe(false);
  });
});

describe('cardTheme', () => {
  it('maps code languages to a fixed palette', () => {
    const ts = cardTheme('# API\n\n```ts\nconst a = 1\n```');
    const tsAgain = cardTheme('# API\n\n```ts\nconst a = 1\n```');
    expect(ts.isCode).toBe(true);
    expect(ts.language).toBe('ts');
    expect(ts.palette.name).toBe(tsAgain.palette.name);
  });

  it('picks palettes deterministically for prose documents', () => {
    const a = cardTheme('# Alpha\n\nFirst document body.');
    const aAgain = cardTheme('# Alpha\n\nFirst document body.');
    const b = cardTheme('# Beta\n\nA completely different document.');
    // Same input → same palette; different inputs pick from the same set.
    expect(a.palette.name).toBe(aAgain.palette.name);
    expect(PALETTES.some((p) => p.name === b.palette.name)).toBe(true);
  });

  it('prose documents are not marked as code', () => {
    const t = cardTheme('# 教程\n\n这是一篇中文文档，介绍负载测试的基本概念。');
    expect(t.isCode).toBe(false);
    expect(t.language).toBeNull();
  });
});
