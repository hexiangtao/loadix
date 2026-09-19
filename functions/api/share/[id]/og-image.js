// GET /api/share/:id/og-image — dynamic Open Graph card for shared Markdown.
// The response is SVG to keep this route dependency-free and portable on
// Cloudflare Pages Functions; social crawlers receive a real image URL.
import { readShare, renderOgCard } from '../../../_lib/share-core.mjs';

export const onRequestGet = async ({ params, env }) => {
  const record = await readShare(params.id, env.SHARE_KV);
  if (!record || (record.expiresAt != null && record.expiresAt <= Date.now())) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(renderOgCard(record.source), {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'x-content-type-options': 'nosniff',
    },
  });
};
