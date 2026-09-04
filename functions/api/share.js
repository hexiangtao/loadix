// POST /api/share — store a markdown document and mint a short share id.
// Cloudflare Pages Functions route file; all logic lives in ../_lib/share-core.mjs
// (shared with the local preview server and the unit tests).
import { postShare } from '../_lib/share-core.mjs';

export const onRequestPost = ({ request, env }) => postShare(request, env.SHARE_KV);
