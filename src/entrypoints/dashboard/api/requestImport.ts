import { parseCurl } from '@/shared/curl';
import type { ApiMethod, ApiRequest } from './apiTypes';
import { parseQueryParams } from './urlUtil';

/** Convert a cURL command into the request-editor fields. */
export function requestPatchFromCurl(input: string): Partial<ApiRequest> {
  const parsed = parseCurl(input);
  const isForm = parsed.contentType === 'application/x-www-form-urlencoded';
  return {
    method: parsed.method as ApiMethod,
    url: parsed.url,
    params: parseQueryParams(parsed.url),
    headers: parsed.headers,
    body: {
      type: parsed.contentType === 'application/json' ? 'json' : isForm ? 'form' : 'text',
      content: isForm ? '' : parsed.body,
      form: isForm ? Array.from(new URLSearchParams(parsed.body).entries()) : [],
    },
  };
}

/** Convert either a plain HTTP(S) URL or a cURL command into editor fields. */
export function requestPatchFromInput(input: string): Partial<ApiRequest> {
  const value = input.trim();
  if (!value) throw new Error('Paste a URL or cURL command first.');
  if (/^curl(?:\s|$)/i.test(value)) return requestPatchFromCurl(value);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a complete HTTP or HTTPS URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
  return {
    method: 'GET',
    url: value,
    params: parseQueryParams(value),
  };
}
