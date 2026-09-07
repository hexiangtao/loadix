// Shared backend core for the "share a rendered markdown document" feature.
//
// Framework-agnostic on purpose: Cloudflare Pages Functions
// (functions/api/*.js) call into this file, the local preview server
// (.freebuff/serve-share.mjs) imports the same functions, and the unit tests
// exercise it directly. It only relies on WHATWG Request/Response/fetch
// globals (available in workerd and Node >= 18) and on a KV-shaped store
// ({ get(key) -> string|null, put(key, value) }).

export const ID_LENGTH = 8;
/** Owner-token length: the secret that lets the creating client re-publish
    (PUT) or revoke (DELETE) a share. Never returned by public reads. */
export const TOKEN_LENGTH = 24;
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

/** Constant-time string comparison for owner tokens (length first, then XOR). */
export function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
  let expiresAt;
  if (contentType.includes('application/json')) {
    try {
      const data = JSON.parse(raw);
      if (data === null || typeof data !== 'object' || typeof data.source !== 'string') {
        return { error: 'invalid_json' };
      }
      source = data.source;
      if (typeof data.expiresAt === 'number') expiresAt = data.expiresAt;
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
  return { source, expiresAt };
}

/** POST /api/share — stores the source, returns { id, url, ownerToken }. */
export async function postShare(request, kv) {
  const parsed = await parseShareBody(request);
  if (parsed.error) {
    return json({ error: parsed.error }, parsed.error === 'source_too_large' ? 413 : 400);
  }
  const id = makeId();
  const now = Date.now();
  const expiresAt =
    typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt) && parsed.expiresAt > now
      ? parsed.expiresAt
      : null;
  const record = {
    source: parsed.source,
    createdAt: now,
    updatedAt: now,
    ownerToken: makeId(TOKEN_LENGTH),
    ...(expiresAt ? { expiresAt } : {}),
  };
  await kv.put(kvKey(id), JSON.stringify(record));
  return json({ id, url: `/s/${id}`, ownerToken: record.ownerToken }, 201);
}

/** Reads a stored share record (including the owner token); null when the id
    is invalid, missing, or malformed. Internal — public callers use getShare. */
export async function readShare(id, kv) {
  if (!isValidId(id)) return null;
  const raw = await kv.get(kvKey(id));
  if (raw === null || raw === undefined) return null;
  try {
    const record = JSON.parse(raw);
    if (!record || typeof record.source !== 'string') return null;
    return {
      id,
      source: record.source,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : null,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : null,
      ownerToken: typeof record.ownerToken === 'string' ? record.ownerToken : null,
      expiresAt:
        typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt) ? record.expiresAt : null,
    };
  } catch {
    return null;
  }
}

/** GET /api/share/:id — public read. Returns { id, source, createdAt, updatedAt };
    the owner token is never exposed. Expired links behave exactly like revoked
    ones for visitors (404 → the viewer's removed page) while the record stays
    in place so the owner can renew it. */
export async function getShare(id, kv) {
  const record = await readShare(id, kv);
  if (!record) return json({ error: 'not_found' }, 404);
  if (record.expiresAt != null && record.expiresAt <= Date.now()) {
    return json({ error: 'not_found' }, 404);
  }
  return json({
    id: record.id,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
  });
}

/**
 * PUT /api/share/:id/expiry — set (absolute timestamp ms) or clear (null) a
 * link's expiration. Requires the owner token. Only future timestamps are
 * accepted; past values would 404 the link immediately and confuse the owner.
 */
export async function setShareExpiry(id, expiresAt, token, kv) {
  if (!isValidId(id)) return json({ error: 'not_found' }, 404);
  if (
    expiresAt !== null &&
    (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
  ) {
    return json({ error: 'invalid_expiry' }, 400);
  }
  const record = await readShare(id, kv);
  if (!record) return json({ error: 'not_found' }, 404);
  if (!record.ownerToken || !tokensEqual(record.ownerToken, token)) {
    return json({ error: 'forbidden' }, 403);
  }
  const updated = { ...record, expiresAt };
  await kv.put(kvKey(id), JSON.stringify(updated));
  return json({ id, expiresAt });
}

/**
 * PUT /api/share/:id — re-publish the source to the same link. Requires the
 * owner token (X-Share-Token header). Returns { id, url, updatedAt }.
 */
export async function updateShare(id, source, token, kv) {
  if (!isValidId(id)) return json({ error: 'not_found' }, 404);
  if (!source.trim()) return json({ error: 'empty_source' }, 400);
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) {
    return json({ error: 'source_too_large' }, 413);
  }
  const record = await readShare(id, kv);
  if (!record) return json({ error: 'not_found' }, 404);
  if (!record.ownerToken || !tokensEqual(record.ownerToken, token)) {
    return json({ error: 'forbidden' }, 403);
  }
  const updated = { ...record, source, updatedAt: Date.now() };
  await kv.put(kvKey(id), JSON.stringify(updated));
  return json({ id, url: `/s/${id}`, updatedAt: updated.updatedAt });
}

/**
 * DELETE /api/share/:id — revoke a link. Requires the owner token. The record
 * is removed, so subsequent reads return 404 (the viewer shows a removed page).
 */
export async function deleteShare(id, token, kv) {
  if (!isValidId(id)) return json({ error: 'not_found' }, 404);
  const record = await readShare(id, kv);
  if (!record) return json({ error: 'not_found' }, 404);
  if (!record.ownerToken || !tokensEqual(record.ownerToken, token)) {
    return json({ error: 'forbidden' }, 403);
  }
  await kv.delete(kvKey(id));
  return new Response(null, { status: 204 });
}

/** Page title from markdown: the first H1, else the first heading of any
    level, else ''. Mirrors docStore.firstHeading in the dashboard — a small
    intentional duplicate, since the functions runtime can't import the app
    bundle. */
export function firstHeading(content) {
  const h1 = /^#\s+(.+?)\s*$/m.exec(content);
  if (h1) return cleanHeading(h1[1]);
  const any = /^#{1,6}\s+(.+?)\s*$/m.exec(content);
  return any ? cleanHeading(any[1]) : '';
}

function cleanHeading(raw) {
  return raw.replace(/[*_`~]/g, '').trim();
}

export const FALLBACK_PAGE_TITLE = 'Shared document · Loadix';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bakes the document's own title into the viewer HTML (title tag + Open
    Graph / Twitter meta), so links shared into chat and office apps preview
    with real context instead of the generic brand line. */
export function renderSharePage(html, source) {
  const heading = firstHeading(source);
  const title = heading ? `${heading} · Loadix` : FALLBACK_PAGE_TITLE;
  const description = heading ? `${heading} — shared via Loadix` : 'Shared via Loadix';
  const meta = [
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    '<meta property="og:type" content="article" />',
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
  ].join('\n    ');
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace('</head>', `    ${meta}\n  </head>`);
}
