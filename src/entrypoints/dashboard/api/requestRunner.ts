/**
 * Request execution for the Requests module.
 *
 * Two transport paths, one executor:
 *  - Chrome extension: the background service worker runs the fetch
 *    (host_permissions exempt it from CORS), exactly like the load engine.
 *  - Web build / fallback: the request runs in-page — subject to normal
 *    browser CORS, surfaced via `errorKind: 'cors'` so the UI can explain.
 *
 * Variable interpolation ({{name}}) happens here, before the wire — the
 * underlying executor is a pure HTTP pass-through.
 */

import { executeRawRequest, type RawRequest, type RawResponse } from '@/engine/runner';
import type { ApiAuth, ApiBody, ApiRequest } from './apiTypes';
import { DEFAULT_TIMEOUT_MS, uid } from './apiTypes';
import { interpolateNested } from './variables';

/** Build the wire request from the editor model, resolving variables. */
export function buildRawRequest(request: ApiRequest, vars: Record<string, string>): RawRequest {
  const headers = [...request.headers];
  // Auth-derived headers are appended after user headers so they win on
  // conflict (later assignments override earlier ones in the executor).
  headers.push(...authHeaders(request.auth, vars));
  const body = bodyContent(request.body);
  const hasBody = body.length > 0 && request.method !== 'GET' && request.method !== 'HEAD';
  if (hasBody && !headers.some(([k]) => k.toLowerCase() === 'content-type')) {
    headers.push(['Content-Type', contentTypeFor(request.body.type)]);
  }
  // Nested interpolation: environment/global values may themselves
  // reference other variables (`{{baseUrl}}` where baseUrl = `https://{{host}}`).
  return {
    method: request.method,
    url: interpolateNested(request.url, vars),
    headers: headers
      .filter(([k]) => k.trim().length > 0)
      .map(([k, v]) => [k.trim(), interpolateNested(v, vars)] as [string, string]),
    body: hasBody ? interpolateNested(body, vars) : undefined,
    timeout: DEFAULT_TIMEOUT_MS,
  };
}

/**
 * A cancellable in-flight send. `abort()` stops the request (via the SW's
 * AbortController on the extension path, via the passed signal in-page) and
 * the promise resolves with `errorKind: 'aborted'`.
 */
export interface SendHandle {
  promise: Promise<RawResponse>;
  abort: () => void;
}

/**
 * Send a request. Prefers the background service worker (CORS-free); falls
 * back to in-page execution when the bridge is unavailable or errors.
 */
export function sendRequest(raw: RawRequest): SendHandle {
  const controller = new AbortController();
  const id = uid();

  let promise: Promise<RawResponse>;
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      promise = chrome.runtime
        .sendMessage({ type: 'API_REQUEST', id, request: raw })
        .then((res: unknown) => {
          if (res && typeof res === 'object' && 'status' in res && 'body' in res) return res as RawResponse;
          throw new Error((res as { error?: string } | undefined)?.error ?? 'Background request failed');
        })
        .catch(() => executeRawRequest(raw, { signal: controller.signal }));
    } else {
      promise = executeRawRequest(raw, { signal: controller.signal });
    }
  } catch {
    promise = executeRawRequest(raw, { signal: controller.signal });
  }

  return {
    promise,
    abort: () => {
      controller.abort();
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        void chrome.runtime.sendMessage({ type: 'API_ABORT', id }).catch(() => {});
      }
    },
  };
}

/** Derived Authorization headers for the configured auth type ('' when none). */
export function authHeaders(auth: ApiAuth, vars: Record<string, string>): [string, string][] {
  switch (auth.type) {
    case 'bearer':
      return auth.token.trim() ? [['Authorization', `Bearer ${interpolateNested(auth.token, vars)}`]] : [];
    case 'basic': {
      if (!auth.username.trim()) return [];
      const raw = `${interpolateNested(auth.username, vars)}:${interpolateNested(auth.password, vars)}`;
      return [['Authorization', `Basic ${base64(raw)}`]];
    }
    case 'apikey':
      return auth.key.trim() ? [[auth.key.trim(), interpolateNested(auth.value, vars)]] : [];
    default:
      return [];
  }
}

/** Serialize the body editor model to a wire string ('' when none). */
export function bodyContent(body: ApiBody): string {
  switch (body.type) {
    case 'json':
    case 'text':
      return body.content;
    case 'form':
      return new URLSearchParams(body.form.filter(([k]) => k.trim().length > 0)).toString();
    case 'graphql': {
      // GraphQL-over-HTTP: `{ "query": …, "variables": … }`.
      // Invalid variables JSON is skipped rather than producing a broken
      // payload — the query still goes out.
      let variables: unknown = undefined;
      if (body.gqlVariables.trim()) {
        try {
          variables = JSON.parse(body.gqlVariables);
        } catch {
          variables = undefined;
        }
      }
      return JSON.stringify(variables === undefined ? { query: body.content } : { query: body.content, variables });
    }
    default:
      return '';
  }
}

function contentTypeFor(type: ApiBody['type']): string {
  switch (type) {
    case 'json':
    case 'graphql':
      return 'application/json';
    case 'form':
      return 'application/x-www-form-urlencoded';
    case 'text':
      return 'text/plain';
    default:
      return 'text/plain';
  }
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}