import { describe, expect, it } from 'vitest';
import { buildQueryString, currentQuery, parseQueryParams, replaceQuery } from './urlUtil';

describe('parseQueryParams', () => {
  it('parses query rows in order', () => {
    expect(parseQueryParams('https://x.com/a?page=1&limit=10')).toEqual([
      ['page', '1'],
      ['limit', '10'],
    ]);
  });

  it('decodes percent-encoded values and plus-sign spaces', () => {
    expect(parseQueryParams('https://x.com/?q=a%20b&tag=c%2Bd')).toEqual([
      ['q', 'a b'],
      ['tag', 'c+d'],
    ]);
  });

  it('returns [] for a URL without a query', () => {
    expect(parseQueryParams('https://x.com/a')).toEqual([]);
  });

  it('ignores the hash fragment', () => {
    expect(parseQueryParams('https://x.com/?a=1#section')).toEqual([['a', '1']]);
  });

  it('keeps a key without a value as an empty value', () => {
    expect(parseQueryParams('https://x.com/?flag')).toEqual([['flag', '']]);
  });

  it('tolerates malformed percent-encoding', () => {
    expect(parseQueryParams('https://x.com/?a=%zz')).toEqual([['a', '%zz']]);
  });
});

describe('buildQueryString', () => {
  it('serializes rows, encoding keys and values', () => {
    expect(buildQueryString([['page', '1'], ['q', 'a b']])).toBe('page=1&q=a%20b');
  });

  it('drops rows without a key', () => {
    expect(buildQueryString([['', 'x'], ['a', '1']])).toBe('a=1');
  });
});

describe('replaceQuery', () => {
  it('preserves protocol/host/path/hash', () => {
    expect(replaceQuery('https://x.com/a/b#top', [['a', '1']])).toBe('https://x.com/a/b?a=1#top');
  });

  it('strips the query entirely when params are empty', () => {
    expect(replaceQuery('https://x.com/a?old=1', [])).toBe('https://x.com/a');
  });
});

describe('currentQuery', () => {
  it('returns the raw query string', () => {
    expect(currentQuery('https://x.com/?a=1&b=2#h')).toBe('a=1&b=2');
  });

  it('returns "" when absent', () => {
    expect(currentQuery('https://x.com/')).toBe('');
  });
});

describe('URL ↔ params sync invariants', () => {
  it('parse → build is idempotent', () => {
    const url = 'https://x.com/?q=a%20b&limit=10';
    const rows = parseQueryParams(url);
    expect(`${url.split('?')[0]}?${buildQueryString(rows)}`).toBe(url);
  });
});