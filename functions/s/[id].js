// GET /s/:id — serve the viewer page with the document's own title baked in
// (title tag + Open Graph / Twitter meta), so links shared into chat and
// office apps preview with real context. Unknown/invalid ids fall through to
// the static `/s/* → /share.html` rewrite, where the client-side viewer shows
// its own not-found state.
import { readShare, renderSharePage } from '../../_lib/share-core.mjs';

export const onRequestGet = async ({ params, env, request, next }) => {
  const record = await readShare(params.id, env.SHARE_KV);
  if (!record) return next();
  const asset = await env.ASSETS.fetch(new URL('/share.html', request.url));
  const html = await asset.text();
  return new Response(renderSharePage(html, record.source), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};