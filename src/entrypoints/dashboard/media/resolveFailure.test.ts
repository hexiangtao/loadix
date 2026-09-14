import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en.json';
import fr from '../i18n/locales/fr.json';
import ja from '../i18n/locales/ja.json';
import ko from '../i18n/locales/ko.json';
import zhCN from '../i18n/locales/zh-CN.json';
import {
  bestFailure,
  classifyClientFailure,
  FAILURE_COPY_KEY,
  failureFromError,
  hostOf,
  type ResolveFailure,
  type ResolveFailureReason,
} from './resolveFailure';

/** Every reason the taxonomy can produce. Kept as a list of literals so a new
 *  member of the union fails the copy guard below rather than shipping as a
 *  raw i18n key to a user. */
const ALL_REASONS: ResolveFailureReason[] = [
  'network',
  'blocked',
  'login',
  'rate-limited',
  'unavailable',
  'drm',
  'no-format',
  'bad-url',
  'backend',
  'unknown',
];

/** The shape the real fetchers throw: structured fields plus a message. */
function fetcherError(fields: Record<string, unknown> = {}, message = 'fetch failed') {
  const error = new Error(message) as Error & Record<string, unknown>;
  Object.assign(error, fields);
  return error;
}

describe('failureFromError', () => {
  it('reads the structured fields a real fetcher attaches', () => {
    const failure = failureFromError(
      fetcherError({ kind: 'network', url: 'https://api.bilibili.com/x/y', code: 'ECONNRESET' }),
    );
    expect(failure).toEqual({ reason: 'network', host: 'api.bilibili.com', detail: 'ECONNRESET' });
  });

  it('maps an HTTP status the site returned to a reason, keeping the status', () => {
    // A 403 is a refusal, not a network problem: the site answered.
    expect(failureFromError(fetcherError({ kind: 'http', url: 'https://www.youtube.com/x', status: 403 }))).toEqual({
      reason: 'blocked',
      host: 'www.youtube.com',
      status: 403,
      detail: undefined,
    });
    expect(failureFromError(fetcherError({ kind: 'http', status: 404 })).reason).toBe('unavailable');
    expect(failureFromError(fetcherError({ kind: 'http', status: 502 })).reason).toBe('backend');
    expect(failureFromError(fetcherError({ kind: 'http', status: 400 })).reason).toBe('bad-url');
  });

  it('classifies a runtime error code as a network failure', () => {
    // undici puts the code on `cause`, which is how a real fetch failure arrives.
    const error = new Error('fetch failed');
    (error as Error & { cause?: unknown }).cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' };
    expect(failureFromError(error)).toMatchObject({ reason: 'network', detail: 'ENOTFOUND' });
  });

  it('recognises a login wall and a region lock in the message alone', () => {
    // These cross the extension message boundary as plain text, so pattern
    // matching is the only route left.
    expect(failureFromError(new Error('HTTP 403 sign in to confirm')).reason).toBe('login');
    expect(failureFromError(new Error('This video is not available in your country')).reason).toBe('unavailable');
    expect(failureFromError(new Error('SAMPLE-AES streams are DRM-protected')).reason).toBe('drm');
    expect(failureFromError(new Error('The operation was aborted due to timeout')).reason).toBe('network');
  });

  it('says unknown instead of inventing a story', () => {
    const failure = failureFromError(new Error('weird internal state'));
    expect(failure.reason).toBe('unknown');
    expect(failure.detail).toBe('weird internal state');
  });
});

describe('classifyClientFailure', () => {
  it('reads a bare HTTP status out of a message with no structured fields', () => {
    // Every fetcher built before the fields existed throws exactly this, and
    // the status alone is enough to pick the right advice.
    expect(failureFromError(new Error('HTTP 429'))).toMatchObject({ reason: 'blocked', status: 429 });
    expect(failureFromError(new Error('HTTP 504'))).toMatchObject({ reason: 'network', status: 504 });
  });

  it('maps the backend error codes the endpoint actually returns', () => {
    // `fetch failed` is the one from the reported bug: the SERVER could not
    // reach the site. Calling that "the site is blocking us" is exactly the
    // message this module exists to kill.
    expect(classifyClientFailure({ error: 'fetch failed', pageUrl: 'https://www.bilibili.com/bangumi/play/ep1' })).toEqual({
      reason: 'network',
      host: 'www.bilibili.com',
      detail: 'fetch failed',
    });
    expect(classifyClientFailure({ error: 'bad-url' })).toMatchObject({ reason: 'bad-url' });
    // Our own throttle is not the site refusing — the instruction differs
    // ("wait a minute" vs "the site said no"), so the reason does too.
    expect(classifyClientFailure({ error: 'rate-limited' })).toMatchObject({
      reason: 'rate-limited',
      host: undefined,
    });
    expect(classifyClientFailure({ error: 'not-http' }).reason).toBe('bad-url');
  });

  it('reads an upstream status relayed by the backend', () => {
    expect(classifyClientFailure({ error: 'upstream-403', pageUrl: 'https://v.douyin.com/x' })).toEqual({
      reason: 'blocked',
      host: 'v.douyin.com',
      status: 403,
    });
  });

  it('reads an HTTP status out of a service-worker message', () => {
    expect(classifyClientFailure({ error: 'HTTP 404', pageUrl: 'https://www.bilibili.com/video/BV1' })).toMatchObject({
      reason: 'unavailable',
      status: 404,
    });
  });

  it('treats a bare 5xx from our own endpoint as a backend failure', () => {
    expect(classifyClientFailure({ status: 502 })).toEqual({ reason: 'backend', host: undefined, status: 502 });
  });
});

describe('bestFailure', () => {
  it('prefers the most specific, most actionable reason', () => {
    const reported: ResolveFailure[] = [
      { reason: 'network', host: 'www.youtube.com' },
      { reason: 'login', host: 'www.youtube.com' },
    ];
    // The network error came from an unrelated probe; the login wall is the one
    // the user can act on.
    expect(bestFailure(reported)?.reason).toBe('login');
  });

  it('prefers DRM over everything, because retrying can never help', () => {
    expect(bestFailure([{ reason: 'network' }, { reason: 'drm' }])?.reason).toBe('drm');
  });

  it('returns nothing when nothing was reported', () => {
    expect(bestFailure([])).toBeUndefined();
  });
});

describe('hostOf', () => {
  it('never throws on garbage', () => {
    expect(hostOf(undefined)).toBeUndefined();
    expect(hostOf('not a url')).toBeUndefined();
    expect(hostOf('https://www.bilibili.com/x')).toBe('www.bilibili.com');
  });
});

describe('failure copy', () => {
  // The taxonomy is only worth anything if every branch ends in an instruction
  // the user can follow. A reason with no copy would render as a raw key — which
  // is how a "we improved the error messages" change ends up shipping an uglier
  // failure than the sentence it replaced.
  const panelCopy = en.media as Record<string, string>;

  it('has copy for every reason', () => {
    const declared = Object.keys(FAILURE_COPY_KEY).sort();
    expect(declared).toEqual([...ALL_REASONS].sort());
  });

  it('resolves every reason to real title and hint strings', () => {
    for (const reason of ALL_REASONS) {
      const suffix = FAILURE_COPY_KEY[reason];
      for (const kind of ['Title', 'Hint'] as const) {
        const value = panelCopy[`${suffix}${kind}`];
        expect(value, `${suffix}${kind} is missing`).toBeTruthy();
        expect(value!.trim().length).toBeGreaterThan(10);
      }
    }
  });

  it('keeps every reason mapped to its own copy', () => {
    // Copy-paste of a neighbouring branch is the easy mistake here, and it is
    // invisible in review — two reasons would simply say the same wrong thing.
    const suffixes = ALL_REASONS.map((reason) => FAILURE_COPY_KEY[reason]);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  it('defines the copy in every supported language', () => {
    // i18next falls back to English silently, so a missing translation looks
    // like a working string in review. Anyone reading the panel in zh/ja/ko/fr
    // would get English mid-UI, and nobody would notice in a diff.
    const locales = { en, 'zh-CN': zhCN, ja, ko, fr } as Record<string, { media: Record<string, string> }>;
    for (const [lang, bundle] of Object.entries(locales)) {
      for (const reason of ALL_REASONS) {
        const suffix = FAILURE_COPY_KEY[reason];
        expect(bundle.media[`${suffix}Title`], `${lang} is missing ${suffix}Title`).toBeTruthy();
        expect(bundle.media[`${suffix}Hint`], `${lang} is missing ${suffix}Hint`).toBeTruthy();
      }
    }
  });
});
