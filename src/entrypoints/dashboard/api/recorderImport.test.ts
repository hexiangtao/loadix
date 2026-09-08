import { describe, expect, it } from 'vitest';
import { importCaptures } from './recorderImport';
import { redactCapture, type RawCapturedRequest, type RecorderCapture } from './recorderTypes';

function raw(overrides: Partial<RawCapturedRequest> = {}): RawCapturedRequest {
  return {
    method: 'GET',
    url: 'https://api.example.com/ping',
    headers: [],
    body: null,
    status: 200,
    statusText: 'OK',
    responseHeaders: [],
    responseBody: '{"ok":true}',
    responseTruncated: false,
    durationMs: 12,
    source: 'fetch',
    ...overrides,
  };
}

function capture(overrides: Partial<RawCapturedRequest> = {}): RecorderCapture {
  return redactCapture(raw(overrides));
}

function makeRequestCapture(opts: {
  method?: string;
  url?: string;
  headers?: [string, string][];
  body?: string | null;
  status?: number;
  statusText?: string;
  responseBody?: string;
  responseHeaders?: [string, string][];
  contentType?: string;
}): RecorderCapture {
  const headers = [...(opts.headers ?? [])];
  if (opts.body != null && opts.contentType) headers.push(['Content-Type', opts.contentType]);
  return capture({
    method: opts.method ?? 'GET',
    url: opts.url ?? 'https://api.example.com/x',
    headers,
    body: opts.body ?? null,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? 'OK',
    responseBody: opts.responseBody ?? '{}',
    responseHeaders: opts.responseHeaders ?? [],
  });
}

describe('redactCapture', () => {
  it('redacts authorization/cookie headers into {{name}} placeholders', () => {
    const c = capture({
      headers: [
        ['Authorization', 'Bearer abc123'],
        ['X-Custom', 'keep-me'],
        ['Cookie', 'session=xyz'],
      ],
      url: 'https://api.example.com/x',
    });
    expect(c.headers).toEqual([
      ['Authorization', '{{Authorization}}'],
      ['X-Custom', 'keep-me'],
      ['Cookie', '{{Cookie}}'],
    ]);
    expect(c.redacted.headers).toEqual(['authorization', 'cookie']);
  });

  it('redacts sensitive query params and keeps their position', () => {
    const c = capture({ url: 'https://api.example.com/x?token=abc&page=2&api_key=zzz' });
    expect(c.url).toContain('token={{token}}');
    expect(c.url).toContain('api_key={{api_key}}');
    expect(c.url).toContain('page=2');
    expect(c.redacted.urlParams).toEqual(['token', 'api_key']);
  });

  it('redacts nested JSON body fields, recursively', () => {
    const c = capture({
      body: '{"user":"emilys","meta":{"password":"p4ss","role":"admin"}}',
      headers: [['Content-Type', 'application/json']],
    });
    const parsed = JSON.parse(c.body!);
    expect(parsed.user).toBe('emilys');
    expect(parsed.meta.password).toBe('{{password}}');
    expect(parsed.meta.role).toBe('admin');
    expect(c.redacted.bodyFields).toEqual(['meta.password']);
  });

  it('replaces sensitive container keys (auth, credentials) wholesale', () => {
    const c = capture({
      body: '{"auth":{"password":"p4ss","token":"t"},"data":"keep"}',
      headers: [['Content-Type', 'application/json']],
    });
    const parsed = JSON.parse(c.body!);
    expect(parsed.auth).toBe('{{auth}}');
    expect(parsed.data).toBe('keep');
  });

  it('drops set-cookie from response headers', () => {
    const c = capture({
      responseHeaders: [
        ['content-type', 'application/json'],
        ['set-cookie', 'session=abc; Path=/'],
      ],
    });
    expect(c.responseHeaders).toEqual([['content-type', 'application/json']]);
  });

  it('does not redact benign names like author or message', () => {
    const c = capture({
      url: 'https://api.example.com/x?author=jane&message=hi',
      headers: [['X-Author', 'jane']],
      body: '{"author":"jane"}',
    });
    expect(c.url).toContain('author=jane');
    expect(c.url).toContain('message=hi');
    expect(c.headers).toEqual([['X-Author', 'jane']]);
  });
});

describe('importCaptures — request generation', () => {
  it('builds one ApiRequest per capture, in order, with names from the URL', () => {
    const a = makeRequestCapture({ url: 'https://api.example.com/users', method: 'GET', responseBody: '[]' });
    const b = makeRequestCapture({ url: 'https://api.example.com/users/42', method: 'DELETE', status: 204, statusText: 'No Content' });
    const result = importCaptures([a, b], { withJourney: true });
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]!.method).toBe('GET');
    expect(result.requests[0]!.url).toBe('https://api.example.com/users');
    expect(result.requests[1]!.method).toBe('DELETE');
    expect(result.requests[0]!.name).toBe('Users');
    expect(result.requests[1]!.name).toBe('Users 2');
    expect(result.journey).not.toBeNull();
    expect(result.journey!.steps).toHaveLength(2);
    expect(result.journey!.steps[0]).toMatchObject({ kind: 'request' });
    expect(result.journey!.stopOnFailure).toBe(false);
  });

  it('maps JSON bodies and skips unsupported methods with a warning', () => {
    const ok = makeRequestCapture({
      method: 'POST',
      url: 'https://api.example.com/notes',
      body: '{"title":"hi"}',
      contentType: 'application/json',
    });
    const trace = capture({ method: 'TRACE', url: 'https://api.example.com/x' });
    const result = importCaptures([ok, trace], { withJourney: false });
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]!.body.type).toBe('json');
    expect(result.requests[0]!.body.content).toBe('{"title":"hi"}');
    expect(result.warnings.some((w) => w.includes('TRACE'))).toBe(true);
    expect(result.journey).toBeNull();
  });
});

describe('importCaptures — auto extraction', () => {
  it('extracts a JSON body value used in a later URL query param', () => {
    const login = makeRequestCapture({
      url: 'https://api.example.com/login',
      method: 'POST',
      body: '{"user":"emilys","password":"p4ss"}',
      contentType: 'application/json',
      responseBody: '{"id":"user-77"}',
    });
    const me = makeRequestCapture({ url: 'https://api.example.com/me?id=user-77' });
    const result = importCaptures([login, me], { withJourney: true });

    expect(result.extracts).toHaveLength(1);
    expect(result.extracts[0]![0]).toBe(0);
    expect(result.extracts[0]![1]).toMatchObject({ kind: 'json', source: '$.id' });

    expect(result.bindings).toEqual([[1, 'id', 'step:0:id']]);
    // The literal value is replaced by the variable in the imported request.
    expect(result.requests[1]!.url).toBe('https://api.example.com/me?id={{id}}');
    expect(result.requests[0]!.extract).toHaveLength(1);
    // Journey step 1 carries the binding.
    const step1 = result.journey!.steps[1] as { bindings: Record<string, string> };
    expect(step1.bindings).toEqual({ id: 'step:0:id' });
  });

  it('does not auto-bind redacted secrets (tokens stay placeholders)', () => {
    const login = makeRequestCapture({
      url: 'https://api.example.com/login',
      responseBody: '{"access_token":"tok-123"}',
    });
    const me = makeRequestCapture({ url: 'https://api.example.com/me?access_token=tok-123' });
    const result = importCaptures([login, me], { withJourney: false });
    expect(result.bindings).toHaveLength(0);
    expect(result.extracts).toHaveLength(0);
    // The secret never survives: the param is a placeholder for the user to fill.
    expect(result.requests[1]!.url).toContain('access_token={{access_token}}');
  });

  it('extracts a path segment value and rewrites the URL', () => {
    const create = makeRequestCapture({
      url: 'https://api.example.com/users',
      method: 'POST',
      body: '{}',
      contentType: 'application/json',
      responseBody: '{"id":77}',
    });
    const get = makeRequestCapture({ url: 'https://api.example.com/users/77' });
    const result = importCaptures([create, get], { withJourney: false });
    expect(result.bindings).toEqual([[1, 'id', 'step:0:id']]);
    expect(result.requests[1]!.url).toBe('https://api.example.com/users/{{id}}');
  });

  it('extracts a value from a response header into a later request header', () => {
    const auth = makeRequestCapture({
      url: 'https://api.example.com/auth',
      responseHeaders: [['X-CSRF', 'csrf-999']],
      responseBody: '{"ok":true}',
    });
    const submit = makeRequestCapture({
      url: 'https://api.example.com/submit',
      method: 'POST',
      headers: [['X-CSRF', 'csrf-999']],
      body: '{}',
      contentType: 'application/json',
    });
    const result = importCaptures([auth, submit], { withJourney: false });
    expect(result.extracts[0]![1]).toMatchObject({ kind: 'header', source: 'X-CSRF', name: 'X-CSRF' });
    expect(result.bindings).toEqual([[1, 'X-CSRF', 'step:0:X-CSRF']]);
    expect(result.requests[1]!.headers).toContainEqual(['X-CSRF', '{{X-CSRF}}']);
  });

  it('does not bind when the value is not present in any earlier response', () => {
    const a = makeRequestCapture({ url: 'https://api.example.com/a', responseBody: '{"x":1}' });
    const b = makeRequestCapture({ url: 'https://api.example.com/b?q=zzz' });
    const result = importCaptures([a, b], { withJourney: true });
    expect(result.bindings).toHaveLength(0);
    expect(result.extracts).toHaveLength(0);
    expect(result.requests[1]!.url).toBe('https://api.example.com/b?q=zzz');
  });

  it('prefers the nearest response and dedupes variable names', () => {
    const a = makeRequestCapture({ url: 'https://api.example.com/a', responseBody: '{"id":"same"}' });
    const b = makeRequestCapture({ url: 'https://api.example.com/b', responseBody: '{"id":"same"}' });
    const c = makeRequestCapture({ url: 'https://api.example.com/c?ref=same' });
    const result = importCaptures([a, b, c], { withJourney: false });
    // Nearest provider (b, step 1) wins.
    expect(result.bindings).toEqual([[2, 'ref', 'step:1:id']]);
  });

  it('skips candidates that are already redaction placeholders', () => {
    const a = makeRequestCapture({ url: 'https://api.example.com/a', responseBody: '{"token":"t1"}' });
    const b = makeRequestCapture({ url: 'https://api.example.com/b?token={{token}}' });
    const result = importCaptures([a, b], { withJourney: false });
    expect(result.bindings).toHaveLength(0);
  });
});