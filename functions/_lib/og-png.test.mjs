// PNG OG card rasterisation tests. resvg-wasm needs a real font buffer to
// draw <text>; the module fetches LXGW WenKai from a CDN, so tests inject a
// local font buffer through the isolate cache (works offline) and assert the
// PNG container shape rather than pixel content. Skipped on machines without
// any usable font file (keeps CI green).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { postShare, readShare } from './share-core.mjs';

const kv = (() => {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => {
      m.set(k, v);
    },
  };
})();

const FONT_CANDIDATES = [
  'C:/Windows/Fonts/arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
];
const fontBuffer = FONT_CANDIDATES.map((p) => (existsSync(p) ? readFileSync(p) : null)).find(Boolean);

/** Minimal PNG container check: 8-byte signature + IHDR dimensions. */
function pngSize(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const arr = Array.from(bytes.slice(0, 8));
  if (!sig.every((b, i) => arr[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function makeShare(source) {
  const res = await postShare(
    new Request('http://local/api/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    }),
    kv,
  );
  const { id } = await res.json();
  return readShare(id, kv);
}

describe('og png card', () => {
  it.skipIf(!fontBuffer)('rasterises the share card to a 1200x630 PNG', async () => {
    const { pngOgCard, setFontFamilyForTests } = await import('./og-png.mjs');
    // Inject a local font under the real cache key and tell the module its
    // actual family so the render path matches production behaviour.
    globalThis.__ogFontCache = new Map([['og-font:lxgw-wenkai', fontBuffer]]);
    setFontFamilyForTests('Arial');

    const record = await makeShare('# Hello Card\n\nSome content.');
    expect(record).toBeTruthy();

    const png = await pngOgCard(record, { SHARE_KV: kv });
    expect(png.byteLength).toBeGreaterThan(1000);
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  });

  it.skipIf(!fontBuffer)('renders latin-only documents without extra fetches', async () => {
    const { pngOgCard, setFontFamilyForTests } = await import('./og-png.mjs');
    globalThis.__ogFontCache = new Map([['og-font:lxgw-wenkai', fontBuffer]]);
    setFontFamilyForTests('Arial');

    const record = await makeShare('# English only');
    const png = await pngOgCard(record, { SHARE_KV: kv });
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  });

  it.skipIf(!fontBuffer)('handles CJK content', async () => {
    const { pngOgCard, setFontFamilyForTests } = await import('./og-png.mjs');
    globalThis.__ogFontCache = new Map([['og-font:lxgw-wenkai', fontBuffer]]);
    setFontFamilyForTests('Arial');

    const record = await makeShare('# 中文标题\n\n这是中文内容。');
    const png = await pngOgCard(record, { SHARE_KV: kv });
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  });
});
