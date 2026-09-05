/**
 * Minimal cURL → TestConfig parser.
 *
 * Covers the ~95% of `curl ...` invocations that real users paste in:
 *  - Method override (`-X`, `--request`)
 *  - Headers (`-H`, `--header`, possibly many)
 *  - Body (`-d`, `--data`, `--data-raw`, `--data-binary`)
 *  - Basic auth (`-u`, `--user`) → synthesises an Authorization header
 *  - Explicit URL (`--url`)
 *
 * Intentionally ignores browser-no-op flags (`-k`, `-L`, `-i`, `--compressed`,
 * `-s`, `-S`, `-v`, `-#`, `-o`, etc.) so a pasted command from a real shell
 * still parses cleanly.
 *
 * NOT supported (return an explicit error to the user):
 *  - Multipart forms (`-F`, `--form`)
 *  - URL-encoded body parts (`--data-urlencode`)
 *  - File uploads / `@filename`
 *  - Cookie jars (`-b`, `-c`)
 *
 * Tokenisation is hand-rolled instead of using a regex split so we can handle:
 *  - Single, double, and unquoted tokens
 *  - `\` line continuations
 *  - Shell-style `\$`, `\"`, `\'`, `\\` escapes inside quotes
 */

export interface ParsedCurl {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  url: string;
  headers: [string, string][];
  body: string;
  contentType: 'application/json' | 'application/x-www-form-urlencoded' | 'text/plain';
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
type Method = (typeof METHODS)[number];

/** Tokenise a multi-line curl command into argv-style tokens. */
export function tokeniseCurl(input: string): string[] {
  // First, resolve `\` line continuations by gluing continued lines
  // together, then strip `#` to-EOL comments from the now-flat string.
  // Doing these in the other order would either leave a stray `\` in the
  // output (after comment-stripping erases the newline that follows it) or
  // smuggle a comment into a joined line.
  const glued = input.replace(/\\\r?\n[ \t]*/g, ' ');
  const noComments = glued.replace(/#.*$/gm, '');

  const tokens: string[] = [];
  let i = 0;
  while (i < noComments.length) {
    const c = noComments[i];
    if (c === undefined) break;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      let buf = '';
      i++;
      while (i < noComments.length) {
        const ch = noComments[i];
        if (ch === '\\' && i + 1 < noComments.length) {
          const next = noComments[i + 1];
          // Recognised shell escapes; everything else is left as-is.
          if (next === '"' || next === "'" || next === '\\' || next === '$' || next === '\n') {
            buf += next ?? '';
            i += 2;
            continue;
          }
        }
        if (ch === quote) {
          i++;
          break;
        }
        buf += ch ?? '';
        i++;
      }
      tokens.push(buf);
      continue;
    }
    // Bare token up to the next whitespace, but if a quoted chunk follows
    // glued to it (e.g. `-H'Auth: ok'` or `-H"Auth: ok"`), the quote and
    // its contents are part of the same token. We unwrap the surrounding
    // quote pair so the parser sees the value bare.
    let buf = '';
    while (i < noComments.length) {
      const ch = noComments[i];
      if (ch === undefined) break;
      if (/\s/.test(ch)) break;
      if (ch === "'" || ch === '"') {
        const quote = ch;
        i++;
        while (i < noComments.length) {
          const inner = noComments[i];
          if (inner === '\\' && i + 1 < noComments.length) {
            const next = noComments[i + 1];
            if (next === '"' || next === "'" || next === '\\' || next === '$' || next === '\n') {
              buf += next ?? '';
              i += 2;
              continue;
            }
          }
          if (inner === quote) {
            i++;
            break;
          }
          buf += inner ?? '';
          i++;
        }
        continue;
      }
      buf += ch;
      i++;
    }
    tokens.push(buf);
  }
  return tokens;
}

/** Convert a base64-style credential into a Basic auth header value. */
function basicAuthHeader(user: string, pass: string): string {
  // btoa works in both browser and (modern) Node; in the extension context
  // it's the standard. The latin1 round-trip is the canonical way to encode
  // arbitrary bytes for btoa.
  const raw = `${user}:${pass}`;
  const bytes = new TextEncoder().encode(raw);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return `Basic ${btoa(bin)}`;
}

/** Mutable parser state, passed by reference so nested helpers don't need
 *  to be re-bound on every call. */
interface ParserState {
  method: Method;
  url: string;
  headers: [string, string][];
  body: string;
  userPass: [string, string] | null;
}

function setMethod(state: ParserState, v: string): void {
  const up = v.toUpperCase();
  if (!METHODS.includes(up as Method)) throw new Error(`Unsupported method: ${v}`);
  state.method = up as Method;
}

function addHeader(state: ParserState, v: string): void {
  const idx = v.indexOf(':');
  if (idx < 0) throw new Error(`Header must be "Key: Value", got: "${v}"`);
  const k = v.slice(0, idx).trim();
  const val = v.slice(idx + 1).trim();
  if (!k) throw new Error(`Header missing key: "${v}"`);
  state.headers.push([k, val]);
}

function setBody(state: ParserState, v: string): void {
  state.body = v;
  if (state.method === 'GET') state.method = 'POST';
}

function setUrl(state: ParserState, v: string): void {
  if (!v.startsWith('http://') && !v.startsWith('https://')) {
    throw new Error(`Only http(s) URLs are supported, got: ${v}`);
  }
  state.url = v;
}

function setUserPass(state: ParserState, v: string): void {
  const idx = v.indexOf(':');
  state.userPass = idx < 0 ? [v, ''] : [v.slice(0, idx), v.slice(idx + 1)];
}

/** Apply the value of a flag (whether attached or in the next token). */
function applyFlagValue(state: ParserState, flag: string, v: string): void {
  switch (flag) {
    case '-X':
    case '--request':
      setMethod(state, v);
      return;
    case '-H':
    case '--header':
      addHeader(state, v);
      return;
    case '-d':
    case '--data':
    case '--data-raw':
    case '--data-binary':
      setBody(state, v);
      return;
    case '-u':
    case '--user':
      setUserPass(state, v);
      return;
    case '--url':
      setUrl(state, v);
      return;
    case '-o':
    case '--output':
    case '-D':
    case '--dump-header':
    case '-b':
    case '--cookie':
      // Sink — discard the value.
      return;
  }
}

/**
 * Parse a cURL command string into a partial TestConfig.
 * Throws on unsupported features or malformed input.
 */
export function parseCurl(input: string): ParsedCurl {
  const tokens = tokeniseCurl(input);
  if (tokens.length === 0) throw new Error('Empty input');

  // Drop the leading "curl" if present.
  if (tokens[0] === 'curl') tokens.shift();

  const state: ParserState = {
    method: 'GET',
    url: '',
    headers: [],
    body: '',
    userPass: null,
  };

  // Flags whose value is attached in the same token (e.g. `-XPOST`,
  // `-HContent-Type: application/json`, `-d{"x":1}`).
  const inline: Record<string, ((v: string) => void) | undefined> = {
    X: (v) => setMethod(state, v),
    H: (v) => addHeader(state, v),
    d: (v) => setBody(state, v),
    u: (v) => setUserPass(state, v),
  };

  // Flags that take a value as the *next* token.
  const takesValue = new Set([
    '-X', '--request',
    '-H', '--header',
    '-d', '--data', '--data-raw', '--data-binary',
    '-u', '--user',
    '--url',
    '-o', '--output',
    '-D', '--dump-header',
    '-b', '--cookie',
  ]);

  // Flags we ignore outright (browser no-ops or output sinks).
  const ignored = new Set([
    '-k', '--insecure', '-L', '--location', '-i', '--include',
    '-s', '--silent', '-S', '--show-error', '-v', '--verbose',
    '--compressed', '-#', '--progress-bar',
    '-O', '--remote-name', '--fail', '-f', '--no-progress-meter',
    '-A', '--user-agent',         // browser sends its own UA
    '-e', '--referer',            // we don't forward
    '--create-dirs', '--remove-on-error',
  ]);

  // Features we explicitly refuse to support (they imply semantics the
  // engine doesn't model — better to fail loudly than silently misroute).
  const unsupported = new Set([
    '-F', '--form', '--form-string',
    '--data-urlencode',
  ]);

  // Track the last-seen flag that takes its value from the *next* token.
  // Wrapped in an object to avoid TS narrowing the closure-captured
  // function union to `never` across assignments inside nested helpers.
  const expecting: { flag: string | null } = { flag: null };

  for (const tok of tokens) {
    if (expecting.flag) {
      applyFlagValue(state, expecting.flag, tok);
      expecting.flag = null;
      continue;
    }
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      const name = eq >= 0 ? tok.slice(0, eq) : tok;
      if (unsupported.has(name)) throw new Error(`Unsupported option: ${name}`);
      if (ignored.has(name)) continue;
      if (takesValue.has(name)) {
        if (eq >= 0) {
          applyFlagValue(state, name, tok.slice(eq + 1));
        } else {
          expecting.flag = name;
        }
        continue;
      }
      // Unknown long flag: best-effort ignore. (See comment in the short-
      // flag branch about why we don't try to be cleverer here.)
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1 && !/^-\d/.test(tok)) {
      let i = 1;
      while (i < tok.length) {
        const letter = tok[i] ?? '';
        const rest = tok.slice(i + 1);
        const short = `-${letter}`;
        if (unsupported.has(short)) throw new Error(`Unsupported option: ${short}`);
        if (ignored.has(short)) {
          i++;
          continue;
        }
        if (inline[letter] && rest.length > 0) {
          // Value is glued (e.g. -XPOST). The rest of the token is the value.
          inline[letter]!(rest);
          break;
        }
        if (takesValue.has(short)) {
          if (rest.length > 0) {
            applyFlagValue(state, short, rest);
          } else {
            expecting.flag = short;
          }
          break;
        }
        // Unknown short flag, best-effort ignore.
        i++;
      }
      continue;
    }
    // Positional argument: must be the URL.
    if (state.url) {
      throw new Error(`Multiple positional arguments found: "${state.url}" and "${tok}"`);
    }
    setUrl(state, tok);
  }

  if (!state.url) {
    throw new Error('No URL found. Make sure the command contains the full http(s) URL.');
  }

  // -u user:pass → Authorization header
  if (state.userPass) {
    const [u, p] = state.userPass;
    state.headers.push(['Authorization', basicAuthHeader(u, p)]);
  }

  // Auto-content-type: leave it to the consumer; default to text/plain when
  // a body is present, json if it looks like JSON, else form-urlencoded.
  const contentType = pickContentType(state.body, state.headers);

  return {
    method: state.method,
    url: state.url,
    headers: state.headers,
    body: state.body,
    contentType,
  };
}

function pickContentType(
  body: string,
  headers: [string, string][],
): 'application/json' | 'application/x-www-form-urlencoded' | 'text/plain' {
  const override = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1];
  if (override) {
    if (override.includes('json')) return 'application/json';
    if (override.includes('x-www-form-urlencoded')) return 'application/x-www-form-urlencoded';
    return 'text/plain';
  }
  if (!body) return 'text/plain';
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'application/json';
  if (/^[\w.+-]+\s*=/.test(trimmed)) return 'application/x-www-form-urlencoded';
  return 'text/plain';
}

/**
 * Inverse of `parseCurl`: build a copy-paste-ready `curl …` command from
 * a TestConfig shell. Used by the "Copy as cURL" button in the request
 * drawer and the request panel.
 *
 * Output style:
 *  - Headers use `-H 'Key: Value'` (single-quoted)
 *  - Body uses `--data-raw` so binary/JSON/Unicode pass through untouched
 *  - Body is only emitted for non-GET/HEAD methods
 *  - Sensitive-looking headers (Authorization, Cookie, X-API-Key) are
 *    still emitted in plaintext — that's the only way the snippet is
 *    useful, and the user explicitly asked to copy a cURL.
 *  - Multi-line output: one flag per line when there's >1 flag, with
 *    `\` continuations so the snippet stays copy-pasteable. URL goes on
 *    the first line; subsequent lines are indented for readability.
 */
export function toCurl(config: {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
  contentType?: string;
}): string {
  const method = config.method.toUpperCase();
  const hasBody = !!config.body && method !== 'GET' && method !== 'HEAD';
  // When the user has both an explicit Content-Type header and a
  // `contentType` config field, the header wins — we don't emit both
  // (cURL doesn't care, but it makes the snippet noisy and confuses
  // readers). Case-insensitive comparison because HTTP headers are
  // case-insensitive.
  const hasContentTypeHeader = config.headers.some(([k]) => k.toLowerCase() === 'content-type');
  const showContentType = !!config.contentType && hasBody && !hasContentTypeHeader;
  const flags: string[] = [];

  if (method !== 'GET') flags.push(`-X ${method}`);
  for (const [k, v] of config.headers) {
    if (!k) continue;
    flags.push(`-H ${shellQuote(`${k}: ${v}`)}`);
  }
  if (showContentType) flags.push(`-H ${shellQuote(`Content-Type: ${config.contentType}`)}`);
  if (hasBody) flags.push(`--data-raw ${shellQuote(config.body)}`);

  const url = shellQuote(config.url);

  // Plain GET with no flags: `curl URL`.
  if (flags.length === 0) return `curl ${url}`;

  // Short commands (≤2 flags, no body) keep the single-line form for
  // one-liner-friendliness: `curl -X POST -H 'A: 1' URL`.
  if (flags.length <= 2 && !hasBody) {
    return `curl ${flags.join(' ')} ${url}`;
  }

  // Multi-line form: URL first as the "head" line, then one flag per
  // continuation line ending in `\` so the snippet stays a single
  // logical cURL invocation when pasted into a shell. The URL line is
  // intentionally bare (no trailing `\`) so the snippet reads naturally
  // at a glance; subsequent lines use `\` continuations so they glue
  // back to the URL when the user pastes them into a shell. That same
  // `\` handling also makes the output round-trip through `tokeniseCurl`
  // cleanly when pasted back into the importer.
  const lines = [`curl ${url}`];
  for (let i = 0; i < flags.length - 1; i++) lines.push(`  ${flags[i]} \\`);
  lines.push(`  ${flags[flags.length - 1]}`);
  return lines.join('\n');
}

/**
 * Quote a value for the shell. Prefers single-quoted strings (the
 * canonical, fully-portable POSIX form) but switches to double quotes
 * whenever the value contains a single quote — POSIX single quotes
 * can't contain a `'` at all, and the `'foo'\''bar'` workaround breaks
 * naïve tokenisers (including ours). Inside double quotes we still need
 * to escape `\` and `$` for bash, but `'` is fine.
 */
function shellQuote(value: string): string {
  if (value === '') return "''";
  // No special chars → single-quoted, the cheapest form to read.
  if (!/["'\\\n\r\u0000$`]/.test(value)) return `'${value}'`;
  // Has a single quote: use double quotes; `'` needs no escape inside.
  if (value.includes("'")) {
    return `"${value.replace(/[\\$`"]/g, (m) => '\\' + m)}"`;
  }
  // Has backslash / newline / `$` / backtick but no single quote:
  // single-quoted is fine because none of those have meaning inside
  // single quotes.
  return `'${value}'`;
}
