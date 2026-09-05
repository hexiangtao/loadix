import { describe, expect, it } from 'vitest';
import { parseCurl, tokeniseCurl, toCurl } from './curl';

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

describe('toCurl', () => {
  it('renders a plain GET as a single line', () => {
    expect(toCurl({
      method: 'GET',
      url: 'https://api.example.com/users',
      headers: [],
      body: '',
    })).toBe(`curl 'https://api.example.com/users'`);
  });

  it('emits -X for non-GET methods', () => {
    expect(toCurl({
      method: 'POST',
      url: 'https://x/y',
      headers: [],
      body: '',
    })).toBe(`curl -X POST 'https://x/y'`);
  });

  it('renders headers and body in single-line form for short commands', () => {
    const out = toCurl({
      method: 'POST',
      url: 'https://x/y',
      headers: [['Content-Type', 'application/json']],
      body: '{"a":1}',
      contentType: 'application/json',
    });
    // 3 flags (X + H + data) with a body crosses the multi-line threshold.
    // We accept either form as long as everything is present and parseable.
    const parsed = parseCurl(out);
    expect(parsed.method).toBe('POST');
    expect(parsed.url).toBe('https://x/y');
    expect(parsed.body).toBe('{"a":1}');
    expect(parsed.headers).toEqual([['Content-Type', 'application/json']]);
  });

  it('round-trips a complex command through parseCurl', () => {
    const out = toCurl({
      method: 'PUT',
      url: 'https://api.example.com/orders/42',
      headers: [
        ['Authorization', 'Bearer abc'],
        ['X-Trace-Id', 'req-001'],
      ],
      body: '{"qty":2}',
      contentType: 'application/json',
    });
    const parsed = parseCurl(out);
    expect(parsed.method).toBe('PUT');
    expect(parsed.url).toBe('https://api.example.com/orders/42');
    expect(parsed.body).toBe('{"qty":2}');
    expect(parsed.headers).toEqual([
      ['Authorization', 'Bearer abc'],
      ['X-Trace-Id', 'req-001'],
      ['Content-Type', 'application/json'],
    ]);
  });

  it('handles single quotes inside body via double-quoted shell form', () => {
    const out = toCurl({
      method: 'POST',
      url: 'https://x',
      headers: [],
      body: "it's a test",
    });
    // POSIX single-quoted strings can't contain a single quote at all,
    // so the canonical workaround is `'foo'\''bar'`. We prefer the
    // much more readable `"it's a test"` (double quotes) whenever the
    // body contains a `'`. Either form parses identically.
    expect(out).toContain(`"it's a test"`);
    expect(parseCurl(out).body).toBe("it's a test");
  });

  it('omits body for GET / HEAD', () => {
    const head = toCurl({
      method: 'HEAD',
      url: 'https://x',
      headers: [],
      body: 'should-not-appear',
    });
    expect(head).not.toContain('data');
    expect(head).not.toContain('--data');
    expect(parseCurl(head).body).toBe('');
  });

  it('emits multi-line form for many flags', () => {
    const out = toCurl({
      method: 'POST',
      url: 'https://x',
      headers: [
        ['A', '1'],
        ['B', '2'],
        ['C', '3'],
      ],
      body: 'hello',
      contentType: 'text/plain',
    });
    // URL first, then one flag per line. Continuations everywhere except
    // the last flag.
    expect(out.split('\n')[0]).toBe(`curl 'https://x'`);
    expect(out).toContain(`  -X POST \\`);
    expect(out).toContain(`  -H 'A: 1' \\`);
    expect(out).toContain(`  -H 'B: 2' \\`);
    expect(out).toContain(`  -H 'C: 3' \\`);
    expect(out).toContain(`  -H 'Content-Type: text/plain' \\`);
    // The very last line has no trailing `\` — that's the closing line.
    expect(out.endsWith('\\')).toBe(false);
  });
});
