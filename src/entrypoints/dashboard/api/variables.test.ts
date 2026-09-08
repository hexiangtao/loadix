import { describe, expect, it } from 'vitest';
import type { RawResponse } from '@/engine/runner';
import { applyExtractRules, interpolateNested, mergedVars } from './variables';

describe('mergedVars', () => {
  it('resolves precedence extracted > env > global', () => {
    const merged = mergedVars({
      global: [['token', 'g'], ['name', 'global'], ['onlyGlobal', 'x']],
      env: [['token', 'e'], ['name', 'env']],
      extracted: [['token', 'x'], ['fresh', '1']],
    });
    expect(merged.token).toBe('x');
    expect(merged.name).toBe('env');
    expect(merged.onlyGlobal).toBe('x');
    expect(merged.fresh).toBe('1');
  });

  it('drops empty keys', () => {
    expect(mergedVars({ env: [['', 'v']], global: [[' ', 'v']], extracted: [] })).toEqual({});
  });
});

describe('interpolateNested', () => {
  it('resolves chained references iteratively', () => {
    const vars = { host: 'api.example.com', baseUrl: 'https://{{host}}', apiUrl: '{{baseUrl}}/v1' };
    expect(interpolateNested('{{apiUrl}}/users', vars)).toBe('https://api.example.com/v1/users');
  });

  it('leaves unknown references empty (matches interpolate)', () => {
    expect(interpolateNested('a{{missing}}b', {})).toBe('ab');
  });

  it('terminates on circular references (placeholder left unresolved)', () => {
    const vars = { a: '{{b}}', b: '{{a}}' };
    // Must return promptly without hanging; the unresolved placeholder
    // stays in the output rather than crashing.
    expect(interpolateNested('{{a}}', vars).length).toBeLessThan(20);
  });
});

describe('applyExtractRules', () => {
  const response: RawResponse = {
    status: 200,
    statusText: 'OK',
    ok: true,
    headers: [['content-type', 'application/json'], ['X-Rate-Limit', '120']],
    body: '{"token":"abc123","user":{"id":7},"items":[{"n":"a"},{"n":"b"}]}',
    ms: 10,
    bytes: 0,
    finalUrl: '',
    error: '',
    errorKind: '',
  };

  it('extracts JSONPath values', () => {
    const rules = [
      { id: '1', name: 'token', kind: 'json' as const, source: '$.token' },
      { id: '2', name: 'userId', kind: 'json' as const, source: '$.user.id' },
      { id: '3', name: 'firstItem', kind: 'json' as const, source: '$.items[0].n' },
    ];
    expect(applyExtractRules(response, rules)).toEqual([
      ['token', 'abc123'],
      ['userId', '7'],
      ['firstItem', 'a'],
    ]);
  });

  it('extracts regex capture groups', () => {
    const rules = [
      { id: '1', name: 'hex', kind: 'regex' as const, source: 'token":"([a-z0-9]+)"', group: 1 },
      { id: '2', name: 'whole', kind: 'regex' as const, source: '"id":7', group: 0 },
    ];
    expect(applyExtractRules(response, rules)).toEqual([
      ['hex', 'abc123'],
      ['whole', '"id":7'],
    ]);
  });

  it('extracts headers case-insensitively', () => {
    const rules = [
      { id: '1', name: 'rate', kind: 'header' as const, source: 'x-rate-limit' },
      { id: '2', name: 'ct', kind: 'header' as const, source: 'Content-Type' },
    ];
    expect(applyExtractRules(response, rules)).toEqual([
      ['rate', '120'],
      ['ct', 'application/json'],
    ]);
  });

  it('skips unmatched rules and bad regexes without failing', () => {
    const rules = [
      { id: '1', name: 'nope', kind: 'json' as const, source: '$.missing' },
      { id: '2', name: 'bad', kind: 'regex' as const, source: '([unclosed' },
      { id: '3', name: '', kind: 'json' as const, source: '$.token' },
      { id: '4', name: 'still', kind: 'json' as const, source: '$.user.id' },
    ];
    expect(applyExtractRules(response, rules)).toEqual([['still', '7']]);
  });

  it('stringifies objects and numbers', () => {
    const rules = [
      { id: '1', name: 'user', kind: 'json' as const, source: '$.user' },
      { id: '2', name: 'second', kind: 'json' as const, source: '$.items[1].n' },
    ];
    expect(applyExtractRules(response, rules)).toEqual([
      ['user', '{"id":7}'],
      ['second', 'b'],
    ]);
  });
});