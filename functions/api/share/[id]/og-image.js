// GET /api/share/:id/og-image — dynamic Open Graph card for shared Markdown.
// Returns a PNG (universally accepted by social crawlers — Lark, WeChat,
// Facebook, Twitter). The card design lives in share-core.renderOgCard and
// rasterisation happens via resvg-wasm.
import { handlePngRequest } from '../../../_lib/og-png.mjs';

export const onRequestGet = (ctx) => handlePngRequest(ctx);
