/**
 * Shared types + redaction for the live traffic recorder.
 *
 * The recorder content script (src/entrypoints/recorder.content.ts) intercepts
 * fetch / XHR in the recorded tab, redacts sensitive material before it ever
 * touches extension storage, and hands RecorderCapture[] to the dashboard
 * RecorderPanel, which converts them into requests + a replayable Journey via
 * recorderImport.ts.
 *
 * Redaction policy (pure, unit-tested here):
 *  - request headers named authorization / cookie / x-api-key / token / … are
 *    replaced with a `{{name}}` placeholder (replay sends an empty value
 *    unless the user defines the variable — safe by default);
 *  - URL query params whose name looks sensitive get the same treatment;
 *  - JSON / urlencoded request bodies walk their keys the same way;
 *  - response `set-cookie` headers are dropped for the same reason;
 *  - response bodies are kept (they drive variable extraction) but truncated
 *    to a bounded size.
 */

/** Where redaction happened on one capture. */
export interface RecorderRedactions {
  /** Lowercased request header names whose value was replaced. */
  headers: string[];
  /** URL query param names whose value was replaced. */
  urlParams: string[];
  /** Dotted paths of request-body fields replaced (e.g. `auth.password`). */
  bodyFields: string[];
}

/** One intercepted request/response pair. */
export interface RecorderCapture {
  id: string;
  /** Page that fired the request. */
  pageUrl: string;
  pageTitle: string;
  /** Wall-clock capture time. */
  ts: number;
  /** Round-trip duration in ms (0 when no response). */
  durationMs: number;
  source: 'fetch' | 'xhr';
  method: string;
  /** Full URL — query params redacted in place. */
  url: string;
  /** Request headers — sensitive values redacted in place. */
  headers: [string, string][];
  /** Request body (redacted), or null when the request had none. */
  body: string | null;
  status: number;
  statusText: string;
  /** Response headers — `set-cookie` redacted. */
  responseHeaders: [string, string][];
  /** Response body, truncated; '' when none. */
  responseBody: string;
  responseTruncated: boolean;
  redacted: RecorderRedactions;
}

/** Header names whose entire value is replaced, request side. */
const SENSITIVE_HEADER_RE =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|access-token|refresh-token|token)$/i;

/** Name-based test for query params / body keys / generic headers. */
const SENSITIVE_NAME_RE =
  /(^|[-_. ])(token|secret|password|passwd|pass|apikey|api[-_.]?key|authorization|credential|session|jwt|auth)([-_. ]|$)/i;

/** Query param names that are always redacted (case-insensitive). */
const SENSITIVE_PARAM_RE =
  /(^|[-_.])(token|secret|password|passwd|pass|apikey|api[-_.]?key|authorization|credential|session|jwt|auth)([-_.]|$)/i;

export const CAPTURE_LIMIT = 200;
/** Cap stored response bodies at 64 KiB (plenty for extraction). */
export const RESPONSE_BODY_CAP = 64 * 1024;

/** Collision-safe id (same strategy as the rest of the workspace). */
export function recorderUid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeVarName(name: string): string {
  const clean = name.replace(/[^\w.-]+/g, '_');
  return clean || 'redacted';
}

function redactValue(key: string): string {
  return `{{${sanitizeVarName(key)}}}`;
}

export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME_RE.test(name);
}

/** Replace sensitive request header values with `{{name}}` placeholders. */
export function redactRequestHeaders(headers: [string, string][]): {
  headers: [string, string][];
  redacted: string[];
} {
  const redacted: string[] = [];
  const out: [string, string][] = [];
  for (const [key, value] of headers) {
    if (SENSITIVE_HEADER_RE.test(key) || SENSITIVE_NAME_RE.test(key)) {
      redacted.push(key.toLowerCase());
      out.push([key, redactValue(key)]);
    } else {
      out.push([key, value]);
    }
  }
  return { headers: out, redacted };
}

/** Restore `{{...}}` placeholders that URL encoding escaped (`%7B%7B`). */
export function restorePlaceholders(input: string): string {
  return input.replace(/%7B%7B/g, '{{').replace(/%7D%7D/g, '}}');
}

/** Redact sensitive values in a URL's query string (and basic-auth userinfo). */
export function redactUrlParams(url: string): { url: string; redacted: string[] } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, redacted: [] };
  }
  const redacted: string[] = [];
  if (parsed.username || parsed.password) {
    parsed.username = '';
    parsed.password = '';
    redacted.push('userinfo');
  }
  const out = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (SENSITIVE_PARAM_RE.test(key)) {
      redacted.push(key);
      out.append(key, redactValue(key));
    } else {
      out.append(key, value);
    }
  }
  parsed.search = out.toString();
  return { url: restorePlaceholders(parsed.toString()), redacted };
}

function redactJsonTree(node: unknown, path: string[], hits: string[]): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node.map((item, i) => redactJsonTree(item, [...path, String(i)], hits));
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (SENSITIVE_NAME_RE.test(key)) {
      hits.push([...path, key].join('.'));
      out[key] = redactValue(key);
    } else {
      out[key] = redactJsonTree(value, [...path, key], hits);
    }
  }
  return out;
}

/** Redact sensitive fields in a JSON or urlencoded request body. */
export function redactRequestBody(body: string | null, contentType: string): {
  body: string | null;
  redacted: string[];
} {
  if (!body) return { body, redacted: [] };
  const hits: string[] = [];
  if (/json/i.test(contentType)) {
    try {
      const parsed: unknown = JSON.parse(body);
      const redacted = redactJsonTree(parsed, [], hits);
      return { body: hits.length > 0 ? JSON.stringify(redacted, null, 2) : body, redacted: hits };
    } catch {
      return { body, redacted: [] };
    }
  }
  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    const pairs = body.split('&');
    const out = pairs.map((pair) => {
      const eq = pair.indexOf('=');
      const key = eq < 0 ? pair : pair.slice(0, eq);
      if (SENSITIVE_PARAM_RE.test(decodeURIComponent(key))) {
        hits.push(decodeURIComponent(key));
        const safeKey = sanitizeVarName(key);
        return eq < 0 ? `${safeKey}={{${safeKey}}}` : `${key}=${encodeURIComponent(redactValue(decodeURIComponent(key)))}`;
      }
      return pair;
    });
    return { body: hits.length > 0 ? out.join('&') : body, redacted: hits };
  }
  return { body, redacted: [] };
}

/** Drop `set-cookie` from response headers; everything else stays. */
export function redactResponseHeaders(headers: [string, string][]): [string, string][] {
  return headers.filter(([key]) => !/^set-cookie$/i.test(key));
}

export interface RawCapturedRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
  status: number;
  statusText: string;
  responseHeaders: [string, string][];
  responseBody: string;
  responseTruncated: boolean;
  durationMs: number;
  source: 'fetch' | 'xhr';
}

/** Redact a raw interception into a persisted RecorderCapture. */
export function redactCapture(raw: RawCapturedRequest): RecorderCapture {
  const url = redactUrlParams(raw.url);
  const headers = redactRequestHeaders(raw.headers);
  const contentType = headers.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  const body = redactRequestBody(raw.body, contentType);
  return {
    id: recorderUid(),
    pageUrl: typeof location !== 'undefined' ? location.href : '',
    pageTitle: typeof document !== 'undefined' ? document.title : '',
    ts: Date.now(),
    durationMs: raw.durationMs,
    source: raw.source,
    method: raw.method,
    url: url.url,
    headers: headers.headers,
    body: body.body,
    status: raw.status,
    statusText: raw.statusText,
    responseHeaders: redactResponseHeaders(raw.responseHeaders),
    responseBody: raw.responseBody,
    responseTruncated: raw.responseTruncated,
    redacted: {
      headers: headers.redacted,
      urlParams: url.redacted,
      bodyFields: body.redacted,
    },
  };
}