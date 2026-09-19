// SVG → PNG rasterisation for the Open Graph card route.
//
// Social crawlers (Lark, WeChat, some Telegram clients) ignore SVG og:image
// even though the format is technically valid. This module converts the same
// card the SVG route renders into a real PNG using resvg compiled to WASM.
//
// Fonts: resvg needs a real font buffer to draw <text>. LXGW WenKai covers
// both Latin and CJK glyphs in one file, so a single fetch handles every
// document. It is fetched lazily once per isolate and cached in KV so each
// cold start downloads it at most once per 30 days.

import { readShare, renderOgCard } from './share-core.mjs';

let wasmReady = false;

async function ensureWasm() {
  if (wasmReady) return;
  const { initWasm } = await import('@resvg/resvg-wasm');
  // In Node (tests / local preview) the wasm binary is on disk next to the
  // package; on Cloudflare Pages the wasm module import is inlined by the
  // bundler. Try both.
  let binary = null;
  try {
    const { createRequire } = await import('node:module');
    const { dirname, join } = await import('node:path');
    const { readFile } = await import('node:fs/promises');
    const req = createRequire(import.meta.url);
    // Resolve the package entry (index.js), then find the wasm next to it —
    // package.json itself is not in the package's exports map.
    const entry = req.resolve('@resvg/resvg-wasm');
    binary = await readFile(join(dirname(entry), 'index_bg.wasm'));
  } catch {
    // not running in Node — fall through to the bundler wasm import
  }
  if (!binary) {
    // Vite/Workers: ?init gives the compiled module directly.
    const mod = await import('@resvg/resvg-wasm/index_bg.wasm?init');
    await initWasm(mod.default ?? mod);
    wasmReady = true;
    return;
  }
  await initWasm(binary);
  wasmReady = true;
}

const FONT_URLS = [
  // Primary: jsDelivr gh mirror (fast, CDN-cached)
  'https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai@v1.330/fonts/TTF/LXGWWenKai-Regular.ttf',
  // Fallback: raw.githubusercontent (works even when jsDelivr rate-limits)
  'https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/fonts/TTF/LXGWWenKai-Regular.ttf',
];
const FONT_FAMILY = 'LXGW WenKai';
// Overridable so tests can match their injected font's real family.
let activeFontFamily = FONT_FAMILY;
export function setFontFamilyForTests(family) {
  activeFontFamily = family;
}
const FONT_TTL = 30 * 24 * 3600; // 30 days
const FONT_KEY = 'og-font:lxgw-wenkai';

async function loadFont(env) {
  // isolate-level cache: workers on the same instance reuse the buffer
  if (!globalThis.__ogFontCache) globalThis.__ogFontCache = new Map();
  const cached = globalThis.__ogFontCache.get(FONT_KEY);
  if (cached) return cached;

  if (env?.SHARE_KV) {
    try {
      const stored = await env.SHARE_KV.get(FONT_KEY, { type: 'arrayBuffer' });
      if (stored && stored.byteLength > 1000) {
        // resvg's fontBuffers want a Uint8Array view, not a bare ArrayBuffer
        const view = new Uint8Array(stored);
        globalThis.__ogFontCache.set(FONT_KEY, view);
        return view;
      }
    } catch {
      // KV read failure is non-fatal — fetch from source below
    }
  }

  for (const url of FONT_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 100000) continue; // reject truncated/HTML responses
      const view = new Uint8Array(buf);
      globalThis.__ogFontCache.set(FONT_KEY, view);
      if (env?.SHARE_KV) {
        try {
          await env.SHARE_KV.put(FONT_KEY, buf, { expirationTtl: FONT_TTL });
        } catch {
          // KV write failure is non-fatal; the isolate cache still holds it
        }
      }
      return view;
    } catch {
      // try the next mirror
    }
  }
  return null; // rendering still works, text may fall back to boxes
}

export async function pngOgCard(record, env) {
  await ensureWasm();
  const svg = renderOgCard(record.source);

  const { Resvg } = await import('@resvg/resvg-wasm');
  const font = await loadFont(env);
  const fonts = font ? [font] : [];

  const render = (defaultFontFamily) =>
    new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
      font: {
        fontBuffers: fonts,
        // Must match the family inside the buffer — resvg throws otherwise.
        defaultFontFamily,
        loadSystemFonts: false,
      },
    }).render().asPng();

  try {
    return render(activeFontFamily);
  } catch {
    if (!fonts.length) {
      // No font available: fall back to serving the SVG so the route never
      // breaks (some crawlers still render it).
      return null;
    }
    // Family mismatch (unexpected injected buffer): retry with the original
    // configured family before giving up.
    return render(FONT_FAMILY);
  }
}

export async function handlePngRequest({ params, env }) {
  const record = await readShare(params.id, env.SHARE_KV);
  if (!record || (record.expiresAt != null && record.expiresAt <= Date.now())) {
    return new Response('Not found', { status: 404 });
  }
  const png = await pngOgCard(record, env);
  if (!png) {
    // Font unavailable upstream — serve the SVG variant so og:image at
    // least resolves to an image rather than an error page.
    return new Response(renderOgCard(record.source), {
      status: 200,
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  }
  return new Response(png, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'x-content-type-options': 'nosniff',
    },
  });
}
