// Shared backend core for the "share a rendered markdown document" feature.
//
// Framework-agnostic on purpose: Cloudflare Pages Functions
// (functions/api/*.js) call into this file, the local preview server
// (.freebuff/serve-share.mjs) imports the same functions, and the unit tests
// exercise it directly. It only relies on WHATWG Request/Response/fetch
// globals (available in workerd and Node >= 18) and on a KV-shaped store
// ({ get(key) -> string|null, put(key, value) }).

export const ID_LENGTH = 8;
export const MAX_SOURCE_BYTES = 1024 * 1024; // 1 MiB cap — far above real docs, guards KV bloat
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // no 0/O/1/l/I
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const kvKey = (id) => `share:${id}`;

/** URL-safe random id of `len` chars from a de-ambiguated alphabet. */
export function makeId(len = ID_LENGTH) {
  // globalThis.crypto exists in workerd and Node >= 19 (this repo runs Node 22).
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < len; i++) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return id;
}

/** Rejects anything that could be path tricks, junk, or wildly long ids. */
export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Reads a markdown source from the request body. Accepts either a raw body
 * (text/markdown or no content-type) or a JSON envelope { source }.
 * Returns { source } on success, or { error } with a stable code.
 */
export async function parseShareBody(request) {
  let raw;
  try {
    raw = await request.text();
  } catch {
    return { error: 'unreadable' };
  }
  const contentType = request.headers.get('content-type') ?? '';
  let source = raw;
  if (contentType.includes('application/json')) {
    try {
      const data = JSON.parse(raw);
      if (data === null || typeof data !== 'object' || typeof data.source !== 'string') {
        return { error: 'invalid_json' };
      }
      source = data.source;
    } catch {
      return { error: 'invalid_json' };
    }
  }
  // Note: content is stored verbatim (leading/trailing whitespace is
  // significant in markdown); only a whitespace-only doc is "empty".
  if (!source.trim()) return { error: 'empty_source' };
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) {
    return { error: 'source_too_large' };
  }
  return { source };
}

/** POST /api/share — stores the source, returns { id, url }. */
export async function postShare(request, kv) {
  const parsed = await parseShareBody(request);
  if (parsed.error) {
    return json({ error: parsed.error }, parsed.error === 'source_too_large' ? 413 : 400);
  }
  const id = makeId();
  const record = { source: parsed.source, createdAt: Date.now() };
  await kv.put(kvKey(id), JSON.stringify(record));
  return json({ id, url: `/s/${id}` }, 201);
}

/** GET /api/share/:id — returns { id, source, createdAt } or a JSON 404. */
export async function getShare(id, kv) {
  if (!isValidId(id)) return json({ error: 'not_found' }, 404);
  const raw = await kv.get(kvKey(id));
  if (raw === null || raw === undefined) return json({ error: 'not_found' }, 404);
  try {
    const record = JSON.parse(raw);
    if (!record || typeof record.source !== 'string') return json({ error: 'not_found' }, 404);
    return json({
      id,
      source: record.source,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : null,
    });
  } catch {
    return json({ error: 'not_found' }, 404);
  }
}
