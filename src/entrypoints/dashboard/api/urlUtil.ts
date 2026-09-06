/**
 * Pure helpers for the two-way sync between the URL bar and the Params
 * table. Kept dependency-free and side-effect-free so the sync logic is
 * unit-testable: parse a URL's query into rows, and rebuild a URL from
 * rows without touching protocol / host / path / hash.
 */

/** Split a URL's query string into decoded key/value rows, preserving order. */
export function parseQueryParams(url: string): [string, string][] {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return [];
  const hashIndex = url.indexOf('#');
  const query = url.slice(qIndex + 1, hashIndex < 0 ? undefined : hashIndex);
  if (!query) return [];
  return query
    .split('&')
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const eq = pair.indexOf('=');
      const rawKey = eq < 0 ? pair : pair.slice(0, eq);
      const rawValue = eq < 0 ? '' : pair.slice(eq + 1);
      return [safeDecode(rawKey), safeDecode(rawValue)] as [string, string];
    });
}

/** Encode rows back into a query string (`a=1&b=2`), preserving order. */
export function buildQueryString(params: [string, string][]): string {
  return params
    .filter(([k]) => k.trim().length > 0)
    .map(([k, v]) => `${encodeURIComponent(k.trim())}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Replace the query portion of a URL, keeping protocol/host/path/hash.
 * `params` is the full row list; rows without a key are dropped.
 */
export function replaceQuery(url: string, params: [string, string][]): string {
  const q = buildQueryString(params);
  const hashIndex = url.indexOf('#');
  const base = hashIndex < 0 ? url : url.slice(0, hashIndex);
  const hash = hashIndex < 0 ? '' : url.slice(hashIndex);
  const stripped = base.split('?')[0] ?? base;
  return q ? `${stripped}?${q}${hash}` : `${stripped}${hash}`;
}

/** The query string the URL currently carries ('' when none). */
export function currentQuery(url: string): string {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return '';
  const hashIndex = url.indexOf('#');
  return url.slice(qIndex + 1, hashIndex < 0 ? undefined : hashIndex);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}