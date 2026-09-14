/**
 * Why a resolve produced nothing.
 *
 * The product problem this exists for: the panel used to answer every failure
 * with one sentence — "some sites block non-browser requests, try again later".
 * That message was written for a class of failure it could not actually see,
 * and it is actively misleading. The failure that produced this module was our
 * OWN proxy resetting every bilibili connection: the site was fine, the user's
 * network was fine, and the message told them the site was blocking us. Nobody
 * — user or maintainer — can act on that.
 *
 * So a failure now carries a REASON, decided where the knowledge exists:
 *   - the fetchers know network-level truth (could not connect / timed out) and
 *     attach it to the error they throw (see `FetcherErrorFields`);
 *   - a site adapter knows site-level truth (the player said LOGIN_REQUIRED, the
 *     API answered `-412 request was banned`) and reports it;
 *   - the client (panel) classifies only what never reached the resolver at all
 *     — our own backend refusing, or a message the service worker surfaced.
 *
 * Every reason maps to copy that says what to DO, which is the whole point of
 * the taxonomy. Pure and testable: no network, no globals.
 */

export type ResolveFailureReason =
  /** Could not connect at all: DNS, connection reset, unreachable, timeout. */
  | 'network'
  /** The site answered and refused: 403 / 412 / 429, WAF, bot check, throttle. */
  | 'blocked'
  /** The content needs a signed-in session (login wall, member-only). */
  | 'login'
  /** OUR endpoint throttled this caller. Waiting is the fix; nothing is wrong
   *  with the site or the link. */
  | 'rate-limited'
  /** The site says this content does not exist / is private / is region-locked. */
  | 'unavailable'
  /** Encrypted stream (SAMPLE-AES, Widevine) — not downloadable by design. */
  | 'drm'
  /** The page loaded fine but offers nothing downloadable. */
  | 'no-format'
  /** The pasted text is not a resolvable watch page or media URL. */
  | 'bad-url'
  /** OUR resolver service failed (not the site's doing). */
  | 'backend'
  | 'unknown';

export interface ResolveFailure {
  reason: ResolveFailureReason;
  /** Host the failure belongs to — shown to the user, and the fastest clue in
   *  a bug report. */
  host?: string;
  /** HTTP status, when the site (or our backend) actually answered. */
  status?: number;
  /** The site's own words: `playabilityStatus.reason`, a JSON `message`, an
   *  OS/proxy error code. Shown muted, never instead of the advice. */
  detail?: string;
}

/**
 * Fields the two real fetchers attach to a thrown error so the failure can be
 * classified without guessing from a string. Declared here as the contract
 * between plain-JS fetchers (`functions/_lib/media-resolve-core.mjs`, the
 * extension service worker) and this module.
 *
 *   kind  'network' — fetch rejected; 'http' — a response with a bad status
 *   url   what we were fetching when it failed
 *   status the HTTP status, for `kind: 'http'`
 *   code  the runtime error code (`ECONNRESET`, `ENOTFOUND`, `UND_ERR_…`)
 */
export interface FetcherErrorFields {
  kind?: 'network' | 'http';
  url?: string;
  status?: number;
  code?: string;
}

/** Host of a URL, or undefined — never throws. Used for messages and grouping. */
export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** Machine-readable codes our own endpoint (or the service worker) returns in
 *  its `error` field, and what each one means. */
const BACKEND_CODES: Readonly<Record<string, ResolveFailureReason>> = {
  // The caller's own input was not resolvable — a paste-box problem.
  'bad-url': 'bad-url',
  'not-http': 'bad-url',
  // Our server could not reach the site. This is the exact failure the old
  // copy called "the site is blocking us" — see the module header.
  'fetch failed': 'network',
  'proxy-fetch-failed': 'network',
  'resolve-failed': 'unknown',
  // We throttled the caller, not the site.
  'rate-limited': 'rate-limited',
};

/**
 * Map an HTTP status to a reason. Only statuses whose MEANING is stable across
 * sites are mapped; anything else says `unknown` rather than inventing a story.
 */
function reasonForStatus(status: number): ResolveFailureReason {
  if (status === 400) return 'bad-url';
  if (status === 401 || status === 403 || status === 412 || status === 429) return 'blocked';
  if (status === 404 || status === 410) return 'unavailable';
  if (status === 408 || status === 504) return 'network';
  if (status >= 500) return 'backend';
  return 'unknown';
}

// `Failed to fetch` is the browser's own wording for a blocked cross-origin or
// unreachable request — it is the only thing a page-origin fetch will tell us.
const NETWORK_PATTERNS = /fetch failed|failed to fetch|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ETIMEDOUT|EPIPE|socket hang up|UND_ERR|network|offline|SELF_SIGNED|CERT_/i;
const TIMEOUT_PATTERNS = /timeout|timed out|aborted|AbortError/i;
const LOGIN_PATTERNS = /sign in|signin|login|logged in|not a bot|unauthorized|需要登录|登入/i;
const DRM_PATTERNS = /drm|sample-aes|widevine|playready|fairplay|encrypted stream/i;
const UNAVAILABLE_PATTERNS = /not available|unavailable|private|removed|deleted|does not exist|no longer|地区|不可用|已删除/i;

/** Which reason wins when several were reported for one resolve. Most specific
 *  and most actionable first: a login wall must not be masked by the network
 *  error that an unrelated probe produced, and DRM is never fixable by retrying. */
const PRIORITY: readonly ResolveFailureReason[] = [
  'drm',
  'login',
  'unavailable',
  'rate-limited',
  'blocked',
  'no-format',
  'network',
  'bad-url',
  'backend',
  'unknown',
];

/** Pick the most informative failure out of everything reported. */
export function bestFailure(failures: readonly ResolveFailure[]): ResolveFailure | undefined {
  if (!failures.length) return undefined;
  for (const reason of PRIORITY) {
    const hit = failures.find((failure) => failure.reason === reason);
    if (hit) return hit;
  }
  return failures[0];
}

/**
 * Classify an error thrown by a fetcher.
 *
 * Reads the structured fields when a real fetcher provided them, and falls back
 * to pattern matching on the message for the paths that cannot (an `Error` that
 * crossed the extension message boundary arrives as plain text).
 */
export function failureFromError(error: unknown, fallbackUrl?: string): ResolveFailure {
  const fields = (error ?? {}) as FetcherErrorFields & { message?: string; cause?: { code?: string; message?: string }; name?: string };
  const cause = fields.cause;
  const code = fields.code ?? cause?.code;
  const message = [fields.message, cause?.message, code, fields.name].filter(Boolean).join(' | ');
  const host = hostOf(fields.url ?? fallbackUrl);

  if (fields.kind === 'http' && typeof fields.status === 'number') {
    return { reason: reasonForStatus(fields.status), host, status: fields.status, detail: code };
  }

  if (code) {
    return { reason: 'network', host, detail: code };
  }
  // The words come first, the bare status second: a 403 whose message says
  // "sign in to confirm" is a login wall, and only the site's own wording can
  // tell that apart from an outright refusal.
  if (DRM_PATTERNS.test(message)) return { reason: 'drm', host, detail: message.slice(0, 160) };
  if (LOGIN_PATTERNS.test(message)) return { reason: 'login', host, detail: message.slice(0, 160) };
  if (UNAVAILABLE_PATTERNS.test(message)) return { reason: 'unavailable', host, detail: message.slice(0, 160) };
  // A fetcher that threw `HTTP 403` without structured fields (every fetcher
  // built before those existed, and anything re-thrown in between) still
  // carries the one number that decides the advice.
  const statusInMessage = message.match(/\bHTTP (\d{3})\b/);
  if (statusInMessage) {
    const status = Number(statusInMessage[1]);
    return { reason: reasonForStatus(status), host, status, detail: code };
  }
  if (TIMEOUT_PATTERNS.test(message)) return { reason: 'network', host, detail: 'timeout' };
  if (NETWORK_PATTERNS.test(message)) return { reason: 'network', host, detail: message.slice(0, 160) };
  return { reason: 'unknown', host, detail: fields.message?.slice(0, 160) };
}

/**
 * i18n key suffix per reason.
 *
 * One place, so the taxonomy and the copy cannot drift apart: a new reason
 * without copy fails the test rather than reaching users as a raw key, and the
 * panel renders whatever this maps to instead of switching on the reason
 * itself. The copy is what the user acts on — which is the entire reason this
 * module exists — so it is part of the contract, not a UI detail.
 */
export const FAILURE_COPY_KEY: Readonly<Record<ResolveFailureReason, string>> = {
  network: 'FailNetwork',
  blocked: 'FailBlocked',
  login: 'FailLogin',
  'rate-limited': 'FailRateLimited',
  unavailable: 'FailUnavailable',
  drm: 'FailDrm',
  'no-format': 'FailNoFormat',
  'bad-url': 'FailBadUrl',
  backend: 'FailBackend',
  unknown: 'FailUnknown',
};

/**
 * Classify what a CLIENT saw when the resolve never got far enough to carry a
 * failure of its own: a non-2xx from our endpoint, or an error string the
 * extension's service worker surfaced.
 */
export function classifyClientFailure(input: { error?: string; status?: number; pageUrl?: string }): ResolveFailure {
  const host = hostOf(input.pageUrl);
  const error = (input.error ?? '').trim();

  // `upstream-403` — our backend relayed the site's own status.
  const upstream = error.match(/^upstream-(\d{3})$/);
  if (upstream) {
    const status = Number(upstream[1]);
    return { reason: reasonForStatus(status), host, status };
  }

  const backendReason = BACKEND_CODES[error];
  if (backendReason) {
    // Only the reasons that describe OUR side drop the host: telling a user
    // "could not connect to www.bilibili.com" when the truth is "we refused
    // your request" would be the same mistake in a new place.
    const ours = backendReason === 'bad-url' || backendReason === 'unknown' || backendReason === 'rate-limited';
    return { reason: backendReason, host: ours ? undefined : host, detail: error };
  }

  const httpStatus = error.match(/^HTTP (\d{3})/);
  if (httpStatus) {
    const status = Number(httpStatus[1]);
    return { reason: reasonForStatus(status), host, status };
  }

  if (typeof input.status === 'number' && input.status >= 500 && !error) {
    return { reason: 'backend', host, status: input.status };
  }

  return failureFromError(new Error(error), input.pageUrl);
}
