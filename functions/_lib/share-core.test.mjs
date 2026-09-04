// Unit tests for the share backend core. KV is a plain in-memory Map shim,
// and requests are real WHATWG Request objects — the same code path the
// Cloudflare Pages functions and the local preview server execute.
import { describe, expect, it } from 'vitest';
import {
  ID_LENGTH,
  MAX_SOURCE_BYTES,
  getShare,
  isValidId,
  makeId,
  parseShareBody,
  postShare,
} from './share-core.mjs';

function memKV() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => {
      m.set(k, v);
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
  it('stores the source and returns a shareable url', async () => {
    const kv = memKV();
    const res = await postShare(post(JSON.stringify({ source: '# Shared doc\n\nBody **text**.' })), kv);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(body.url).toBe(`/s/${body.id}`);
    expect(kv._map.size).toBe(1);
    const stored = JSON.parse(kv._map.values().next().value);
    expect(stored.source).toBe('# Shared doc\n\nBody **text**.');
    expect(typeof stored.createdAt).toBe('number');
  });

  it('round-trips through getShare', async () => {
    const kv = memKV();
    const created = await (await postShare(post(JSON.stringify({ source: '## 标题\n\n- 一\n- 二' })), kv)).json();
    const res = await getShare(created.id, kv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.source).toBe('## 标题\n\n- 一\n- 二');
    expect(typeof body.createdAt).toBe('number');
  });

  it('maps validation failures to proper status codes', async () => {
    const kv = memKV();
    expect((await postShare(post('{bad'), kv)).status).toBe(400);
    expect((await postShare(post(JSON.stringify({ source: '   ' })), kv)).status).toBe(400);
    expect((await postShare(post(JSON.stringify({ source: 'x'.repeat(MAX_SOURCE_BYTES + 1) })), kv)).status).toBe(413);
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
