/**
 * Live traffic recorder — content script injected into every http(s) page.
 *
 * While recording, it patches `window.fetch` and `XMLHttpRequest` (at
 * document_start so nothing the page does later escapes) and buffers
 * redacted request/response pairs. Redaction happens in recorderTypes.ts
 * BEFORE anything is persisted, so tokens / passwords / cookies never touch
 * extension storage in the clear.
 *
 * Recording is opt-in per tab and survives reloads: the dashboard sends
 * recorder:start, the state + buffer are persisted to chrome.storage.session
 * (keyed by this tab's id, learned from the service worker), and a fresh
 * document restores them on load — so an SPA refresh mid-recording keeps
 * collecting.
 *
 * Messages (from the dashboard RecorderPanel):
 *   recorder:ping  → { type: 'recorder:state', recording, count }
 *   recorder:start → begin capturing
 *   recorder:stop  → stop capturing (buffer is kept)
 *   recorder:clear → drop the buffer
 *   recorder:get   → { type: 'recorder:state', recording, captures }
 */

import { defineContentScript } from 'wxt/sandbox';
import {
  CAPTURE_LIMIT,
  RESPONSE_BODY_CAP,
  redactCapture,
  type RawCapturedRequest,
  type RecorderCapture,
} from '@/entrypoints/dashboard/api/recorderTypes';

const SAVE_DEBOUNCE_MS = 800;

interface RecorderStateMessage {
  type: 'recorder:state';
  recording: boolean;
  count: number;
  captures?: RecorderCapture[];
}

function isCapturableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isBinaryContentType(contentType: string | null): boolean {
  return /^(image|video|audio|font|application\/octet-stream|application\/pdf|application\/zip|application\/gzip)/i.test(
    contentType ?? '',
  );
}

function truncate(text: string): { text: string; truncated: boolean } {
  return text.length > RESPONSE_BODY_CAP
    ? { text: text.slice(0, RESPONSE_BODY_CAP), truncated: true }
    : { text, truncated: false };
}

function headerEntries(input: Headers | Record<string, string> | [string, string][]): [string, string][] {
  const out: [string, string][] = [];
  if (input instanceof Headers) {
    input.forEach((value, key) => out.push([key, value]));
  } else if (Array.isArray(input)) {
    for (const pair of input) out.push([pair[0], String(pair[1])]);
  } else {
    for (const [key, value] of Object.entries(input)) out.push([key, value]);
  }
  return out;
}

function parseResponseHeaders(raw: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of raw.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    out.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return out;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  // Intercept before page scripts run so nothing slips past the patch.
  runAt: 'document_start',
  main() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.__loadixRecorderBound) return;
    w.__loadixRecorderBound = true;

    let recording = false;
    let startedAt = 0;
    let buffer: RecorderCapture[] = [];
    let tabId: number | null = null;
    let lastSaved = 0;

    const storage = (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (chrome.storage as any).session as typeof chrome.storage.session | undefined;
      } catch {
        return undefined;
      }
    })();

    const persist = (force = false) => {
      if (!storage) return;
      const now = Date.now();
      if (!force && now - lastSaved < SAVE_DEBOUNCE_MS) return;
      lastSaved = now;
      void storage
        .set({
          recorderSession: recording && tabId != null ? { tabId, startedAt } : null,
          recorderBuffer: buffer,
        })
        .catch(() => {});
    };

    const pushCapture = (raw: RawCapturedRequest) => {
      if (!recording || !isCapturableUrl(raw.url)) return;
      buffer.push(redactCapture(raw));
      if (buffer.length > CAPTURE_LIMIT) buffer.splice(0, buffer.length - CAPTURE_LIMIT);
      persist();
    };

    const stateMsg = (captures?: RecorderCapture[]): RecorderStateMessage => ({
      type: 'recorder:state',
      recording,
      count: buffer.length,
      ...(captures ? { captures } : {}),
    });

    const respond = (sendResponse: (msg: RecorderStateMessage) => void) => (msg: RecorderStateMessage) => {
      try {
        sendResponse(msg);
      } catch {
        /* receiver gone */
      }
    };

    /* ——— fetch ——— */
    const originalFetch = window.fetch.bind(window);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const started = performance.now();
      let url = '';
      let method = 'GET';
      let headers: [string, string][] = [];
      let body: string | null = null;
      try {
        if (typeof input === 'string') {
          url = input;
        } else if (input instanceof URL) {
          url = input.href;
        } else {
          url = input.url;
          method = input.method || 'GET';
          headers = headerEntries(input.headers);
        }
        if (init) {
          if (init.method) method = init.method;
          if (init.headers) headers = headerEntries(init.headers as HeadersInit);
          if (init.body != null && typeof init.body === 'string') body = init.body;
        }
      } catch {
        /* never break the page over instrumentation */
      }
      const response = await originalFetch(input, init);
      if (recording && isCapturableUrl(url) && !isBinaryContentType(response.headers.get('content-type'))) {
        void response
          .clone()
          .text()
          .then((responseBody) => {
            const trimmed = truncate(responseBody);
            const responseHeaders: [string, string][] = [];
            response.headers.forEach((value, key) => responseHeaders.push([key, value]));
            pushCapture({
              method: method.toUpperCase(),
              url,
              headers,
              body,
              status: response.status,
              statusText: response.statusText,
              responseHeaders,
              responseBody: trimmed.text,
              responseTruncated: trimmed.truncated,
              durationMs: performance.now() - started,
              source: 'fetch',
            });
          })
          .catch(() => {});
      }
      return response;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    /* ——— XHR ——— */
    const proto = XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    const originalSetRequestHeader = proto.setRequestHeader;
    const originalSend = proto.send;
    const pending = new WeakMap<XMLHttpRequest, { method: string; url: string; headers: [string, string][]; body: string | null; started: number }>();

    proto.open = function open(this: XMLHttpRequest, method: string, url: string | URL) {
      pending.set(this, {
        method: String(method || 'GET').toUpperCase(),
        url: String(url),
        headers: [],
        body: null,
        started: performance.now(),
      });
      // eslint-disable-next-line prefer-rest-params
      return originalOpen.apply(this, arguments as unknown as Parameters<typeof originalOpen>);
    };

    proto.setRequestHeader = function setRequestHeader(this: XMLHttpRequest, name: string, value: string) {
      pending.get(this)?.headers.push([name, value]);
      // eslint-disable-next-line prefer-rest-params
      return originalSetRequestHeader.apply(this, arguments as unknown as Parameters<typeof originalSetRequestHeader>);
    };

    proto.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const info = pending.get(this);
      if (info) {
        info.body = typeof body === 'string' ? body : null;
        this.addEventListener('loadend', () => {
          if (!recording || !info || !isCapturableUrl(info.url)) return;
          const responseHeaders = parseResponseHeaders(this.getAllResponseHeaders());
          let responseBody = '';
          try {
            if (!this.responseType || this.responseType === 'text') responseBody = String(this.responseText ?? '');
          } catch {
            /* some response types throw on responseText */
          }
          const trimmed = truncate(responseBody);
          pushCapture({
            method: info.method,
            url: info.url,
            headers: info.headers,
            body: info.body,
            status: this.status,
            statusText: this.statusText,
            responseHeaders,
            responseBody: trimmed.text,
            responseTruncated: trimmed.truncated,
            durationMs: performance.now() - info.started,
            source: 'xhr',
          });
        });
      }
      // eslint-disable-next-line prefer-rest-params
      return originalSend.apply(this, arguments as unknown as Parameters<typeof originalSend>);
    };

    /* ——— messaging ——— */
    chrome.runtime.onMessage.addListener((msg: { type?: string } | undefined, _sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;
      const reply = respond(sendResponse);
      switch (msg.type) {
        case 'recorder:ping':
          reply(stateMsg());
          break;
        case 'recorder:start':
          recording = true;
          startedAt = Date.now();
          persist(true);
          reply(stateMsg());
          break;
        case 'recorder:stop':
          recording = false;
          persist(true);
          reply(stateMsg());
          break;
        case 'recorder:clear':
          buffer = [];
          persist(true);
          reply(stateMsg());
          break;
        case 'recorder:get':
          reply(stateMsg(buffer));
          break;
      }
    });

    /* ——— restore across reloads ——— */
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resp = (await chrome.runtime.sendMessage({ type: 'recorder:tabid' })) as { tabId?: number } | undefined;
        tabId = resp?.tabId ?? null;
      } catch {
        tabId = null;
      }
      if (storage) {
        try {
          const stored = await storage.get(['recorderSession', 'recorderBuffer']);
          if (stored.recorderSession?.tabId === tabId) {
            recording = true;
            startedAt = stored.recorderSession.startedAt ?? Date.now();
            if (Array.isArray(stored.recorderBuffer)) buffer = stored.recorderBuffer;
          }
        } catch {
          /* session storage unavailable — memory only */
        }
      }
    })();

    window.addEventListener('pagehide', () => persist(true));
  },
});