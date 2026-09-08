import { describe, expect, it } from 'vitest';
import { parseCurl } from '@/shared/curl';
import { createApiRequest, requestFingerprint, snapshotResponse } from './apiTypes';
import { requestPatchFromInput } from './requestImport';

describe('requestPatchFromInput', () => {
  it('turns a URL into a GET request with query params', () => {
    expect(requestPatchFromInput('https://api.example.com/users?page=2')).toEqual({
      method: 'GET',
      url: 'https://api.example.com/users?page=2',
      params: [['page', '2']],
    });
  });

  it('turns a cURL command into request editor fields', () => {
    expect(requestPatchFromInput("curl -X POST 'https://api.example.com/users' -H 'Content-Type: application/json' -d '{\"name\":\"Ada\"}'")).toEqual({
      method: 'POST',
      url: 'https://api.example.com/users',
      params: [],
      headers: [['Content-Type', 'application/json']],
      body: { type: 'json', content: '{"name":"Ada"}', form: [], gqlVariables: '' },
    });
  });

  it('rejects empty and non-http input', () => {
    expect(() => requestPatchFromInput('')).toThrow('Paste a URL or cURL command first.');
    expect(() => requestPatchFromInput('ftp://example.com/file')).toThrow('Only HTTP and HTTPS URLs are supported.');
  });
});

describe('requestFingerprint', () => {
  it('ignores local identity while changing with request contents', () => {
    const first = createApiRequest();
    first.url = 'https://example.com/a';
    const second = { ...first, id: 'another-id', name: 'Named copy', updatedAt: first.updatedAt + 1 };
    const changed = { ...first, url: 'https://example.com/b' };
    expect(requestFingerprint(first)).toBe(requestFingerprint(second));
    expect(requestFingerprint(first)).not.toBe(requestFingerprint(changed));
  });
});

describe('snapshotResponse', () => {
  it('keeps a normal response unchanged', () => {
    const response = {
      status: 200,
      statusText: 'OK',
      ok: true,
      headers: [] as [string, string][],
      body: 'hello',
      ms: 10,
      bytes: 5,
      finalUrl: 'https://example.com',
      error: '',
      errorKind: '',
    } as const;
    expect(snapshotResponse(response)).toEqual({ ...response, bodyTruncated: false });
  });

  it('caps large bodies without changing the source response', () => {
    const response = { ...snapshotResponse({
      status: 200,
      statusText: 'OK',
      ok: true,
      headers: [] as [string, string][],
      body: 'abcdef',
      ms: 10,
      bytes: 6,
      finalUrl: 'https://example.com',
      error: '',
      errorKind: '',
    }), body: 'abcdef' };
    const snapshot = snapshotResponse(response, 3);
    expect(snapshot.body).toBe('abc');
    expect(snapshot.bodyTruncated).toBe(true);
    expect(response.body).toBe('abcdef');
  });

  it('does not add response fields to a new request', () => {
    expect(createApiRequest()).not.toHaveProperty('response');
  });
});

describe('launch cURL compatibility', () => {
  it('accepts a multiline cURL command', () => {
    const parsed = parseCurl('curl https://example.com \\\n  -H "Accept: application/json"');
    expect(parsed.url).toBe('https://example.com');
    expect(parsed.headers).toEqual([['Accept', 'application/json']]);
  });
});
