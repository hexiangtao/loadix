// GET|POST /api/resolve?pageUrl=… — resolve a video watch page into a
// downloadable format list. Cloudflare Pages Functions route; all logic
// lives in ../_lib/media-resolve-core.mjs (shared with the Vite dev
// middleware, the local preview server, and the unit tests).
import { handleResolve } from '../_lib/media-resolve-core.mjs';

export const onRequestGet = ({ request }) => handleResolve(request);

export const onRequestPost = async ({ request }) => {
  const rawBody = await request.text().catch(() => '');
  return handleResolve({ ...request, rawBody });
};
