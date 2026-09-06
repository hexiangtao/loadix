import { describe, expect, it } from 'vitest';
import { createApiRequest } from './apiTypes';
import { authHeaders, bodyContent, buildRawRequest } from './requestRunner';

describe('buildRawRequest', () => {
  it('interpolates variables into URL, headers, body and auth', () => {
    const request = createApiRequest();
    request.method = 'POST';
    request.url = 'https://{{baseUrl}}/users';
    request.headers = [['X-Token', '{{token}}']];
    request.body = { type: 'json', content: '{"user":"{{user}}"}', form: [] };
    request.auth = { type: 'bearer', token: '{{token}}', username: '', password: '', key: '', value: '' };
    const vars = { baseUrl: 'api.example.com', token: 'sekret', user: 'tom' };

    const raw = buildRawRequest(request, vars);
    expect(raw.url).toBe('https://api.example.com/users');
    expect(raw.headers).toEqual([
      ['X-Token', 'sekret'],
      ['Authorization', 'Bearer sekret'],
      ['Content-Type', 'application/json'],
    ]);
    expect(raw.body).toBe('{"user":"tom"}');
  });

  it('adds Content-Type per body type only when missing', () => {
    const request = createApiRequest();
    request.method = 'POST';
    request.url = 'https://x.com';
    request.headers = [['Content-Type', 'text/plain']];
    request.body = { type: 'json', content: '{}', form: [] };
    const raw = buildRawRequest(request, {});
    const contentTypes = raw.headers.filter(([k]) => k.toLowerCase() === 'content-type');
    expect(contentTypes).toEqual([['Content-Type', 'text/plain']]); // not duplicated
  });

  it('serializes form bodies to urlencoded and omits empty rows', () => {
    const request = createApiRequest();
    request.method = 'POST';
    request.url = 'https://x.com';
    request.body = { type: 'form', content: '', form: [['a', '1'], ['b', 'two words'], ['', 'skip']] };
    const raw = buildRawRequest(request, {});
    expect(raw.body).toBe('a=1&b=two+words');
  });

  it('sends no body for GET and drops empty header keys', () => {
    const request = createApiRequest();
    request.url = 'https://x.com';
    request.headers = [['', 'empty'], ['Accept', 'application/json']];
    request.body = { type: 'json', content: '{}', form: [] };
    const raw = buildRawRequest(request, {});
    expect(raw.body).toBeUndefined();
    expect(raw.headers).toEqual([['Accept', 'application/json']]);
  });
});

describe('authHeaders', () => {
  it('builds bearer, basic, and api-key headers', () => {
    expect(authHeaders({ type: 'bearer', token: 't', username: '', password: '', key: '', value: '' }, {}))
      .toEqual([['Authorization', 'Bearer t']]);
    expect(authHeaders({ type: 'basic', token: '', username: 'u', password: 'p', key: '', value: '' }, {}))
      .toEqual([['Authorization', 'Basic dTpw']]);
    expect(authHeaders({ type: 'apikey', token: '', username: '', password: '', key: 'X-API-Key', value: 'v' }, {}))
      .toEqual([['X-API-Key', 'v']]);
  });

  it('returns nothing for none or empty credentials', () => {
    expect(authHeaders({ type: 'none', token: '', username: '', password: '', key: '', value: '' }, {})).toEqual([]);
    expect(authHeaders({ type: 'bearer', token: '', username: '', password: '', key: '', value: '' }, {})).toEqual([]);
    expect(authHeaders({ type: 'basic', token: '', username: '', password: '', key: '', value: '' }, {})).toEqual([]);
  });
});

describe('bodyContent', () => {
  it('returns content for json/text and serialized form otherwise', () => {
    expect(bodyContent({ type: 'json', content: '{}', form: [] })).toBe('{}');
    expect(bodyContent({ type: 'text', content: 'hi', form: [] })).toBe('hi');
    expect(bodyContent({ type: 'none', content: '', form: [] })).toBe('');
  });
});