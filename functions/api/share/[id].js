// GET /api/share/:id — fetch a stored document by its share id.
import { getShare } from '../../_lib/share-core.mjs';

export const onRequestGet = ({ params, env }) => getShare(params.id, env.SHARE_KV);
