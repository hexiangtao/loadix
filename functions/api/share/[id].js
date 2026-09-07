// GET /api/share/:id — fetch a stored document by its share id (public).
// PUT /api/share/:id — re-publish the source to the same link (owner token).
// DELETE /api/share/:id — revoke the link (owner token).
import { deleteShare, getShare, parseShareBody, updateShare } from '../../_lib/share-core.mjs';

export const onRequestGet = ({ params, env }) => getShare(params.id, env.SHARE_KV);

export const onRequestPut = async ({ request, params, env }) => {
  const parsed = await parseShareBody(request);
  if (parsed.error) {
    return new Response(
      JSON.stringify({ error: parsed.error }),
      { status: parsed.error === 'source_too_large' ? 413 : 400, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
  const token = request.headers.get('x-share-token') ?? '';
  return updateShare(params.id, parsed.source, token, env.SHARE_KV);
};

export const onRequestDelete = ({ request, params, env }) => {
  const token = request.headers.get('x-share-token') ?? '';
  return deleteShare(params.id, token, env.SHARE_KV);
};