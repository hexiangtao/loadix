// PUT /api/share/:id/expiry — set or clear a link's expiration (owner token).
// Body: { "expiresAt": <ms timestamp> | null } — null clears the expiration.
// The public GET keeps 404ing while a link is expired; the record survives so
// the owner can renew it here.
import { setShareExpiry } from '../../../_lib/share-core.mjs';

export const onRequestPut = async ({ request, params, env }) => {
  let expiresAt = null;
  try {
    const data = await request.json();
    expiresAt = data?.expiresAt ?? null;
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_json' }),
      { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
  const token = request.headers.get('x-share-token') ?? '';
  return setShareExpiry(params.id, expiresAt, token, env.SHARE_KV);
};