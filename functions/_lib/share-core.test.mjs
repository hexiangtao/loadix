// Unit tests for the share backend core. KV is a plain in-memory Map shim,
// and requests are real WHATWG Request objects — the same code path the
// Cloudflare Pages functions and the local preview server execute.
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_PAGE_TITLE,
  ID_LENGTH,
  MAX_SOURCE_BYTES,
  deleteShare,
  firstHeading,
  getShare,
  isValidId,
  makeId,
  parseShareBody,
  postShare,
  readShare,
  renderSharePage,
  setShareExpiry,
  tokensEqual,
  updateShare,
} from './share-core.mjs';

function memKV() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => {
      m.set(k, v);
    },
    delete: async (k) => {
      m.delete(k);
    },
    _map: m,
  };
}

const post = (body, headers = {}) =>
  new Request('https://lab.loadix.dev/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

describe('makeId', () => {
  it('produces ids of the configured length', () => {
    expect(makeId()).toHaveLength(ID_LENGTH);
    expect(makeId(12)).toHaveLength(12);
  });

  it('uses only URL-safe, de-ambiguated characters', () => {
    const id = makeId(256);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(id).not.toMatch(/[0O1lI]/);
  });

  it('does not collide across many draws', () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) seen.add(makeId());
    expect(seen.size).toBe(5000);
  });
});

describe('isValidId', () => {
  it('accepts normal ids', () => {
    expect(isValidId('Ab3xY9zQ')).toBe(true);
  });

  it('rejects junk, path tricks and wrong lengths', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId('ab')).toBe(false); // too short
    expect(isValidId('a'.repeat(80))).toBe(false); // too long
    expect(isValidId('../etc')).toBe(false);
    expect(isValidId('a b')).toBe(false);
    expect(isValidId('a/b')).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(undefined)).toBe(false);
  });
});

describe('parseShareBody', () => {
  it('accepts a JSON { source } envelope', async () => {
    const { source } = await parseShareBody(post(JSON.stringify({ source: '# hello' })));
    expect(source).toBe('# hello');
  });

  it('accepts a raw text body without a JSON content-type', async () => {
    const { source } = await parseShareBody(
      new Request('https://x/api/share', { method: 'POST', headers: { 'content-type': 'text/markdown' }, body: '# raw' }),
    );
    expect(source).toBe('# raw');
  });

  it('rejects malformed JSON', async () => {
    const parsed = await parseShareBody(post('{oops'));
    expect(parsed.error).toBe('invalid_json');
  });

  it('rejects JSON envelopes without a string source', async () => {
    expect((await parseShareBody(post('{}'))).error).toBe('invalid_json');
    expect((await parseShareBody(post(JSON.stringify({ source: 42 })))).error).toBe('invalid_json');
  });

  it('rejects empty / whitespace-only documents', async () => {
    expect((await parseShareBody(post(JSON.stringify({ source: '' })))).error).toBe('empty_source');
    expect((await parseShareBody(post(JSON.stringify({ source: '   \n ' })))).error).toBe('empty_source');
  });

  it('rejects oversized documents', async () => {
    const big = 'a'.repeat(MAX_SOURCE_BYTES + 1);
    expect((await parseShareBody(post(JSON.stringify({ source: big })))).error).toBe('source_too_large');
  });
});

describe('postShare', () => {
  it('stores the source and returns a shareable url plus an owner token', async () => {
    const kv = memKV();
    const res = await postShare(post(JSON.stringify({ source: '# Shared doc\n\nBody **text**.' })), kv);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(body.url).toBe(`/s/${body.id}`);
    expect(body.ownerToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(kv._map.size).toBe(1);
    const stored = JSON.parse(kv._map.values().next().value);
    expect(stored.source).toBe('# Shared doc\n\nBody **text**.');
    expect(typeof stored.createdAt).toBe('number');
    expect(typeof stored.updatedAt).toBe('number');
    expect(typeof stored.ownerToken).toBe('string');
  });

  it('round-trips through getShare without leaking the owner token', async () => {
    const kv = memKV();
    const created = await (await postShare(post(JSON.stringify({ source: '## 标题\n\n- 一\n- 二' })), kv)).json();
    const res = await getShare(created.id, kv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.source).toBe('## 标题\n\n- 一\n- 二');
    expect(typeof body.createdAt).toBe('number');
    expect(typeof body.updatedAt).toBe('number');
    expect(body.ownerToken).toBeUndefined();
  });

  it('maps validation failures to proper status codes', async () => {
    const kv = memKV();
    expect((await postShare(post('{bad'), kv)).status).toBe(400);
    expect((await postShare(post(JSON.stringify({ source: '   ' })), kv)).status).toBe(400);
    expect((await postShare(post(JSON.stringify({ source: 'x'.repeat(MAX_SOURCE_BYTES + 1) })), kv)).status).toBe(413);
  });
});

describe('tokensEqual', () => {
  it('compares constant-time style', () => {
    expect(tokensEqual('abc123', 'abc123')).toBe(true);
    expect(tokensEqual('abc123', 'abc124')).toBe(false);
    expect(tokensEqual('abc', 'abcd')).toBe(false);
    expect(tokensEqual(null, 'abc')).toBe(false);
  });
});

describe('updateShare', () => {
  async function seeded() {
    const kv = memKV();
    const created = await (await postShare(post(JSON.stringify({ source: '# v1' })), kv)).json();
    return { kv, created };
  }

  it('re-publishes the source to the same link with the right token', async () => {
    const { kv, created } = await seeded();
    const res = await updateShare(created.id, '# v2\n\nUpdated.', created.ownerToken, kv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.url).toBe(`/s/${created.id}`);
    expect(typeof body.updatedAt).toBe('number');
    const read = await (await getShare(created.id, kv)).json();
    expect(read.source).toBe('# v2\n\nUpdated.');
    expect(read.updatedAt).toBe(body.updatedAt);
    expect(typeof read.createdAt).toBe('number');
    expect(read.createdAt).toBeLessThanOrEqual(read.updatedAt);
  });

  it('rejects a wrong or missing token with 403', async () => {
    const { kv, created } = await seeded();
    expect((await updateShare(created.id, '# v2', 'nope', kv)).status).toBe(403);
    expect((await updateShare(created.id, '# v2', '', kv)).status).toBe(403);
    const read = await (await getShare(created.id, kv)).json();
    expect(read.source).toBe('# v1');
  });

  it('returns 404 for unknown or malformed ids', async () => {
    const kv = memKV();
    expect((await updateShare('Missing1', '# v2', 'x'.repeat(24), kv)).status).toBe(404);
    expect((await updateShare('../etc', '# v2', 'x'.repeat(24), kv)).status).toBe(404);
  });

  it('validates the replacement source', async () => {
    const { kv, created } = await seeded();
    expect((await updateShare(created.id, '   ', created.ownerToken, kv)).status).toBe(400);
    expect((await updateShare(created.id, 'x'.repeat(MAX_SOURCE_BYTES + 1), created.ownerToken, kv)).status).toBe(413);
  });

  it('cannot touch legacy shares without an owner token', async () => {
    const kv = memKV();
    await kv.put('share:Ab3xY9zQ', JSON.stringify({ source: '# legacy', createdAt: 1 }));
    expect((await updateShare('Ab3xY9zQ', '# v2', 'x'.repeat(24), kv)).status).toBe(403);
  });
});

describe('deleteShare', () => {
  it('revokes a share: 204, then reads return 404', async () => {
    const kv = memKV();
    const created = await (await postShare(post(JSON.stringify({ source: '# bye' })), kv)).json();
    const res = await deleteShare(created.id, created.ownerToken, kv);
    expect(res.status).toBe(204);
    expect((await getShare(created.id, kv)).status).toBe(404);
  });

  it('rejects a wrong token with 403 and keeps the share live', async () => {
    const kv = memKV();
    const created = await (await postShare(post(JSON.stringify({ source: '# stay' })), kv)).json();
    expect((await deleteShare(created.id, 'wrong-token', kv)).status).toBe(403);
    expect((await getShare(created.id, kv)).status).toBe(200);
  });

  it('returns 404 for unknown or malformed ids', async () => {
    const kv = memKV();
    expect((await deleteShare('Missing1', 'x'.repeat(24), kv)).status).toBe(404);
    expect((await deleteShare('', 'x'.repeat(24), kv)).status).toBe(404);
  });

  it('cannot revoke a legacy share without an owner token', async () => {
    const kv = memKV();
    await kv.put('share:Ab3xY9zQ', JSON.stringify({ source: '# legacy', createdAt: 1 }));
    expect((await deleteShare('Ab3xY9zQ', 'x'.repeat(24), kv)).status).toBe(403);
  });
});

describe('getShare', () => {
  it('returns 404 for an unknown but well-formed id', async () => {
    const res = await getShare('Ab3xY9zQ', memKV());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('returns 404 without touching the store for malformed ids', async () => {
    const kv = memKV();
    const res = await getShare('../etc/passwd', kv);
    expect(res.status).toBe(404);
    expect(kv._map.size).toBe(0);
  });

  it('returns 404 when the stored value is corrupt', async () => {
    const kv = memKV();
    await kv.put('share:Ab3xY9zQ', 'not json');
    const res = await getShare('Ab3xY9zQ', kv);
    expect(res.status).toBe(404);
  });
});

describe('readShare', () => {
  it('returns the record for a stored id and null otherwise', async () => {
    const kv = memKV();
    await kv.put('share:Ab3xY9zQ', JSON.stringify({ source: '# Hi', createdAt: 1 }));
    expect((await readShare('Ab3xY9zQ', kv))?.source).toBe('# Hi');
    expect(await readShare('Ab3xY9zQ!', kv)).toBeNull();
    expect(await readShare('Missing1', kv)).toBeNull();
  });

  it('surfaces a stored expiresAt', async () => {
    const kv = memKV();
    await kv.put('share:Ab3xY9zQ', JSON.stringify({ source: '# Hi', createdAt: 1, expiresAt: 99 }));
    expect((await readShare('Ab3xY9zQ', kv))?.expiresAt).toBe(99);
    expect((await readShare('Ab3xY9zQ', kv))?.expiresAt ?? null).toBe(99);
  });
});

describe('share expiration', () => {
  it('stores expiresAt passed at creation (future only)', async () => {
    const kv = memKV();
    const future = Date.now() + 3_600_000;
    const res = await postShare(post(JSON.stringify({ source: '# Hi', expiresAt: future })), kv);
    expect(res.status).toBe(201);
    const id = (await res.json()).id;
    expect((await readShare(id, kv))?.expiresAt).toBe(future);

    // Past timestamps are treated as "no expiration" (would 404 immediately).
    const past = await postShare(post(JSON.stringify({ source: '# Hi', expiresAt: Date.now() - 1 })), kv);
    const pastId = (await past.json()).id;
    expect((await readShare(pastId, kv))?.expiresAt).toBeNull();
  });

  it('404s public reads after expiry and 200s before', async () => {
    const kv = memKV();
    const future = Date.now() + 3_600_000;
    await kv.put('share:Ab3xY9zQ', JSON.stringify({ source: '# Hi', createdAt: 1, updatedAt: 1, expiresAt: future }));
    expect((await getShare('Ab3xY9zQ', kv)).status).toBe(200);

    await kv.put('share:Ab3xY9zQ', JSON.stringify({ source: '# Hi', createdAt: 1, updatedAt: 1, expiresAt: Date.now() - 1 }));
    const res = await getShare('Ab3xY9zQ', kv);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('setShareExpiry sets, clears, and keeps the source', async () => {
    const kv = memKV();
    await kv.put('share:Ab3xY9zQ', JSON.stringify({ source: '# Hi', createdAt: 1, updatedAt: 1, ownerToken: 'tok-tok-tok' }));
    const future = Date.now() + 86_400_000;
    const set = await setShareExpiry('Ab3xY9zQ', future, 'tok-tok-tok', kv);
    expect(set.status).toBe(200);
    expect((await readShare('Ab3xY9zQ', kv))?.expiresAt).toBe(future);
    expect((await readShare('Ab3xY9zQ', kv))?.source).toBe('# Hi');

    const cleared = await setShareExpiry('Ab3xY9zQ', null, 'tok-tok-tok', kv);
    expect(cleared.status).toBe(200);
    expect((await readShare('Ab3xY9zQ', kv))?.expiresAt).toBeNull();
  });

  it('rejects wrong tokens, past/invalid timestamps, and unknown ids', async () => {
    const kv = memKV();
    await kv.put('share:Ab3xY9zQ', JSON.stringify({ source: '# Hi', createdAt: 1, updatedAt: 1, ownerToken: 'tok-tok-tok' }));
    expect((await setShareExpiry('Ab3xY9zQ', Date.now() + 1000, 'wrong-token', kv)).status).toBe(403);
    expect((await setShareExpiry('Ab3xY9zQ', Date.now() - 1, 'tok-tok-tok', kv)).status).toBe(400);
    expect((await setShareExpiry('Ab3xY9zQ', 'tomorrow', 'tok-tok-tok', kv)).status).toBe(400);
    expect((await setShareExpiry('Missing1', Date.now() + 1000, 'tok-tok-tok', kv)).status).toBe(404);
  });

  it('updateShare keeps an existing expiration', async () => {
    const kv = memKV();
    await kv.put(
      'share:Ab3xY9zQ',
      JSON.stringify({ source: '# old', createdAt: 1, updatedAt: 1, ownerToken: 'tok-tok-tok', expiresAt: 42 }),
    );
    await updateShare('Ab3xY9zQ', '# new', 'tok-tok-tok', kv);
    const record = await readShare('Ab3xY9zQ', kv);
    expect(record.source).toBe('# new');
    expect(record.expiresAt).toBe(42);
  });
});

describe('firstHeading', () => {
  it('prefers the first H1', () => {
    expect(firstHeading('# Real Title\n\nbody')).toBe('Real Title');
  });

  it('falls back to the first heading of any level', () => {
    expect(firstHeading('intro\n\n## Sub title\n')).toBe('Sub title');
  });

  it('strips inline emphasis/code markers and whitespace', () => {
    expect(firstHeading('# **Bold** `code`  \n')).toBe('Bold code');
  });

  it('returns empty for documents without a heading', () => {
    expect(firstHeading('just text')).toBe('');
    expect(firstHeading('#not a heading\n')).toBe('');
  });
});

describe('renderSharePage', () => {
  const html = '<!doctype html><html><head><title>Shared document · Loadix</title></head><body>x</body></html>';

  it('bakes the document heading into the title tag', () => {
    expect(renderSharePage(html, '# My Doc\n\nbody')).toContain('<title>My Doc · Loadix</title>');
  });

  it('adds Open Graph and Twitter meta', () => {
    const out = renderSharePage(html, '# My Doc');
    expect(out).toContain('property="og:title" content="My Doc · Loadix"');
    expect(out).toContain('name="twitter:title"');
    expect(out).toContain('property="og:type" content="article"');
  });

  it('keeps the generic title when the document has no heading', () => {
    expect(renderSharePage(html, 'no heading')).toContain(`<title>${FALLBACK_PAGE_TITLE}</title>`);
  });

  it('escapes HTML in the injected title', () => {
    expect(renderSharePage(html, '# <script>alert(1)</script>')).toContain('&lt;script&gt;');
  });
});
