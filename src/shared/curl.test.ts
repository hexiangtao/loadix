import { describe, expect, it } from 'vitest';
import { parseCurl, tokeniseCurl } from './curl';

describe('tokeniseCurl', () => {
  it('splits simple space-separated tokens', () => {
    expect(tokeniseCurl('curl -X POST https://api.example.com')).toEqual([
      'curl', '-X', 'POST', 'https://api.example.com',
    ]);
  });

  it('handles single and double quotes', () => {
    // Note the body uses a single-quoted JSON literal so the test source's
    // double quotes don't terminate the outer shell quote.
    expect(tokeniseCurl(`curl -H 'A: 1' -d '{"x":1}' https://x`)).toEqual([
      'curl', '-H', 'A: 1', '-d', '{"x":1}', 'https://x',
    ]);
  });

  it('joins line continuations and skips comments', () => {
    const cmd = `# fetch users\ncurl \\\n  -X POST \\\n  # inline comment\n  https://api.example.com/users`;
    expect(tokeniseCurl(cmd)).toEqual(['curl', '-X', 'POST', 'https://api.example.com/users']);
  });

  it('preserves escaped quotes inside quoted strings', () => {
    expect(tokeniseCurl(`curl -d 'it\\'s ok' https://x`)).toEqual(['curl', '-d', "it's ok", 'https://x']);
    expect(tokeniseCurl(`curl -d "say \\"hi\\"" https://x`)).toEqual(['curl', '-d', 'say "hi"', 'https://x']);
  });
});

describe('parseCurl', () => {
  it('parses a basic GET', () => {
    const r = parseCurl('curl https://api.example.com/health');
    expect(r.method).toBe('GET');
    expect(r.url).toBe('https://api.example.com/health');
    expect(r.headers).toEqual([]);
    expect(r.body).toBe('');
  });

  it('parses POST with multiple headers and JSON body', () => {
    const r = parseCurl(
      `curl -X POST 'https://api.example.com/users' \\\n` +
        `  -H 'Content-Type: application/json' \\\n` +
        `  -H 'Authorization: Bearer abc' \\\n` +
        `  --data-raw '{"name":"tom"}'`,
    );
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://api.example.com/users');
    expect(r.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Authorization', 'Bearer abc'],
    ]);
    expect(r.body).toBe('{"name":"tom"}');
    expect(r.contentType).toBe('application/json');
  });

  it('infers POST when -d is used without -X', () => {
    const r = parseCurl(`curl https://api.example.com/x -d 'k=v'`);
    expect(r.method).toBe('POST');
    expect(r.body).toBe('k=v');
    expect(r.contentType).toBe('application/x-www-form-urlencoded');
  });

  it('supports inline -XPOST and quoted -H value', () => {
    const r = parseCurl(`curl -XPUT -H'Auth: ok' https://x`);
    expect(r.method).toBe('PUT');
    expect(r.headers).toEqual([['Auth', 'ok']]);
  });

  it('synthesises Authorization from -u', () => {
    const r = parseCurl(`curl -u alice:s3cret https://x`);
    // base64('alice:s3cret') = 'YWxpY2U6czNjcmV0'
    expect(r.headers).toEqual([['Authorization', 'Basic YWxpY2U6czNjcmV0']]);
  });

  it('honours an explicit Content-Type override for auto-detection', () => {
    const r = parseCurl(`curl -H 'Content-Type: application/x-www-form-urlencoded' -d '{"oops":true}' https://x`);
    expect(r.contentType).toBe('application/x-www-form-urlencoded');
  });

  it('ignores no-op flags like -L, -k, --compressed, -s, -i, -o', () => {
    const r = parseCurl(`curl -L -k -s -i -o /dev/null --compressed https://x`);
    expect(r.url).toBe('https://x');
    expect(r.method).toBe('GET');
  });

  it('supports --url as the URL argument', () => {
    const r = parseCurl(`curl --url https://x -X PATCH`);
    expect(r.url).toBe('https://x');
    expect(r.method).toBe('PATCH');
  });

  it('throws on missing URL', () => {
    expect(() => parseCurl('curl -X POST')).toThrow(/No URL/);
  });

  it('throws on non-http(s) URL', () => {
    expect(() => parseCurl('curl ftp://x')).toThrow(/http\(s\)/);
    expect(() => parseCurl('curl file:///etc/passwd')).toThrow(/http\(s\)/);
  });

  it('throws on malformed header (no colon)', () => {
    expect(() => parseCurl(`curl -H 'broken' https://x`)).toThrow(/Header must be/);
  });

  it('throws on multiple positional URL arguments', () => {
    expect(() => parseCurl('curl https://a https://b')).toThrow(/Multiple positional/);
  });
});
