/**
 * Postman collection import / export for the Requests module.
 *
 * Import reads the collection v2.1 JSON format (the standard export shape
 * of Postman and most tools that interoperate with it): folders become
 * collection trees, requests keep method / URL / headers / body / auth.
 * Unsupported bits (file uploads, request scripts, certificates…) are
 * skipped and reported rather than silently mis-mapped.
 *
 * Both directions are pure functions — no DOM, no storage — so the round
 * trip is unit-testable.
 */

import type { ApiAuth, ApiCollection, ApiMethod, ApiRequest } from './apiTypes';
import { createApiCollection, createApiRequest } from './apiTypes';
import { parseQueryParams } from './urlUtil';

export interface PostmanImportResult {
  collections: ApiCollection[];
  requests: ApiRequest[];
  /** Items that were skipped, with a human-readable reason. */
  skipped: { name: string; reason: string }[];
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: unknown;
  auth?: PostmanAuth;
}

interface PostmanAuth {
  type?: string;
  bearer?: { key: string; value?: string; type?: string }[];
  basic?: { key: string; value?: string; type?: string }[];
  apikey?: { key: string; value?: string; type?: string }[];
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  path?: (string | { type?: string; value?: string })[];
  query?: { key?: string; value?: string; disabled?: boolean }[];
}

interface PostmanRequest {
  method?: string;
  header?: { key?: string; value?: string; disabled?: boolean }[];
  url?: string | PostmanUrl;
  body?: {
    mode?: string;
    raw?: string;
    urlencoded?: { key?: string; value?: string; disabled?: boolean }[];
    graphql?: { query?: string; variables?: string };
    options?: { raw?: { language?: string } };
  };
  auth?: PostmanAuth;
}

const METHODS: ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * Parse a Postman collection v2.1 JSON string into the Requests workspace
 * model. The root collection is created from `info.name`.
 */
export function parsePostmanCollection(input: string): PostmanImportResult {
  const result: PostmanImportResult = { collections: [], requests: [], skipped: [] };
  let root: { info?: { name?: string }; item?: PostmanItem[] };
  try {
    root = JSON.parse(input) as typeof root;
  } catch {
    throw new Error('Not valid JSON — expected a Postman collection export');
  }
  if (!root || typeof root !== 'object') throw new Error('Not a Postman collection export');

  const rootName = root.info?.name?.trim() || 'Imported Collection';
  const rootCollection = createApiCollection(rootName, null);
  result.collections.push(rootCollection);

  const walk = (items: PostmanItem[] | undefined, parentId: string, inheritedAuth?: PostmanAuth) => {
    for (const item of items ?? []) {
      const name = item.name?.trim() || 'Untitled request';
      if (item.item) {
        // A folder — becomes a nested collection; its auth applies to children.
        const folder = createApiCollection(name, parentId);
        result.collections.push(folder);
        walk(item.item, folder.id, item.auth ?? inheritedAuth);
        continue;
      }
      if (!item.request) {
        result.skipped.push({ name, reason: 'No request payload' });
        continue;
      }
      const mapped = mapRequest(name, item.request as PostmanRequest, item.auth ?? inheritedAuth);
      if (mapped.ok) {
        mapped.request.collectionId = parentId;
        result.requests.push(mapped.request);
      } else {
        result.skipped.push({ name, reason: mapped.reason });
      }
    }
  };
  walk(root.item, rootCollection.id, undefined);
  return result;
}

type MapResult = { ok: true; request: ApiRequest } | { ok: false; reason: string };

function mapRequest(name: string, pm: PostmanRequest, auth?: PostmanAuth): MapResult {
  const request = createApiRequest();
  request.name = name;
  request.headers = []; // never inherit the factory's pre-filled Accept row
  request.method = METHODS.includes(pm.method?.toUpperCase() as ApiMethod)
    ? (pm.method!.toUpperCase() as ApiMethod)
    : 'GET';

  const url = resolveUrl(pm.url);
  request.url = url;
  request.params = parseQueryParams(url);

  // Headers: skip disabled ones, tolerate missing keys.
  for (const h of pm.header ?? []) {
    if (h.disabled || !h.key?.trim()) continue;
    request.headers.push([h.key.trim(), h.value ?? '']);
  }

  // Body.
  const body = pm.body;
  if (body) {
    switch (body.mode) {
      case 'raw': {
        const raw = body.raw ?? '';
        const language = body.options?.raw?.language;
        request.body = {
          type: language === 'json' || looksLikeJson(raw) ? 'json' : 'text',
          content: raw,
          form: [],
          gqlVariables: '',
        };
        break;
      }
      case 'urlencoded':
        request.body = {
          type: 'form',
          gqlVariables: '',
          content: '',
          form: (body.urlencoded ?? [])
            .filter((p) => !p.disabled && p.key?.trim())
            .map((p) => [p.key!.trim(), p.value ?? ''] as [string, string]),
        };
        break;
      case 'graphql':
        request.body = {
          type: 'graphql',
          content: body.graphql?.query ?? '',
          gqlVariables: body.graphql?.variables ?? '',
          form: [],
        };
        break;
      case 'formdata':
      case 'file':
        return { ok: false, reason: `Body mode "${body.mode}" is not supported` };
      default:
        request.body = { type: 'none', content: '', form: [], gqlVariables: '' };
    }
  }

  // Auth: request-level wins, else inherited from the folder chain.
  const resolvedAuth = pm.auth ?? auth;
  const mappedAuth = mapAuth(resolvedAuth);
  if (mappedAuth) request.auth = mappedAuth;

  return { ok: true, request };
}

function mapAuth(auth: PostmanAuth | undefined): ApiAuth | null {
  if (!auth?.type) return null;
  const values = (auth[auth.type as keyof PostmanAuth] as { key: string; value?: string }[] | undefined) ?? [];
  const get = (key: string) => values.find((v) => v.key === key)?.value ?? '';
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: get('token'), username: '', password: '', key: '', value: '' };
    case 'basic':
      return { type: 'basic', token: '', username: get('username'), password: get('password'), key: '', value: '' };
    case 'apikey':
      return { type: 'apikey', token: '', username: '', password: '', key: get('key') || 'X-API-Key', value: get('value') };
    default:
      return null; // digest / oauth2 etc. — leave unauthenticated rather than fake it
  }
}

/** Reconstruct a URL string from Postman's url object (or a plain string). */
function resolveUrl(url: PostmanRequest['url']): string {
  if (typeof url === 'string') return url;
  if (!url) return '';
  if (url.raw) return url.raw;
  const protocol = url.protocol || 'https';
  const host = Array.isArray(url.host) ? url.host.join('.') : '';
  const path = Array.isArray(url.path)
    ? url.path
        .map((seg) =>
          typeof seg === 'string'
            ? seg
            : seg.type === 'variable'
              ? `:${seg.value ?? ''}`
              : seg.value ?? '',
        )
        .filter(Boolean)
        .join('/')
    : '';
  const query = (url.query ?? [])
    .filter((q) => !q.disabled && q.key)
    .map((q) => `${encodeURIComponent(q.key!)}=${encodeURIComponent(q.value ?? '')}`)
    .join('&');
  const base = `${protocol}://${host}${path ? `/${path}` : ''}`;
  return query ? `${base}?${query}` : base;
}

function looksLikeJson(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/* ————————————————————————————————————————————————————————————————
 * Export — serialize the workspace back to Postman v2.1
 * ———————————————————————————————————————————————————————————————— */

/**
 * Build a v2.1 collection JSON string from the workspace model.
 *
 * The exported file mirrors the importer: `info.name` becomes the root
 * collection, so each root-level collection in the workspace is emitted as
 * the top-level folders/requests of that root (all roots are merged into
 * the one exported collection). Drafts are never exported.
 */
export function exportPostmanCollection(
  collections: ApiCollection[],
  requests: ApiRequest[],
  rootName: string,
): string {
  const byParent = new Map<string | null, ApiCollection[]>();
  for (const c of collections) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  const requestsByCollection = new Map<string | null, ApiRequest[]>();
  for (const r of requests) {
    if (!r.collectionId) continue; // drafts are not exported
    const list = requestsByCollection.get(r.collectionId) ?? [];
    list.push(r);
    requestsByCollection.set(r.collectionId, list);
  }

  const buildItems = (parentId: string): unknown[] => {
    const items: unknown[] = [];
    for (const collection of byParent.get(parentId) ?? []) {
      const folder: Record<string, unknown> = { name: collection.name, item: buildItems(collection.id) };
      const auth = sharedChildAuth(collection.id, requests);
      if (auth) folder.auth = auth;
      items.push(folder);
    }
    for (const request of requestsByCollection.get(parentId) ?? []) {
      items.push(exportRequest(request));
    }
    return items;
  };

  const roots = byParent.get(null) ?? [];
  const collection: Record<string, unknown> = {
    info: {
      name: roots[0]?.name ?? rootName,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: roots.flatMap((c) => buildItems(c.id)),
  };
  return JSON.stringify(collection, null, 2);
}

function exportRequest(request: ApiRequest): Record<string, unknown> {
  const header = request.headers
    .filter(([k]) => k.trim())
    .map(([k, v]) => ({ key: k, value: v }));
  const body =
    request.body.type === 'none'
      ? undefined
      : {
          mode: request.body.type === 'form' ? 'urlencoded' : 'raw',
          raw: request.body.type === 'form' ? undefined : request.body.content,
          urlencoded:
            request.body.type === 'form'
              ? request.body.form.map(([key, value]) => ({ key, value }))
              : undefined,
        };
  return {
    name: request.name || request.method || 'Request',
    request: {
      method: request.method,
      header,
      url: request.url,
      body,
    },
  };
}

/** Folder-level auth for the export — only when every direct child shares it. */
function sharedChildAuth(collectionId: string, requests: ApiRequest[]): PostmanAuth | undefined {
  const children = requests.filter((r) => r.collectionId === collectionId);
  if (children.length === 0) return undefined;
  const first = children[0]?.auth;
  if (!first || first.type === 'none') return undefined;
  if (!children.every((r) => r.auth.type === first.type)) return undefined;
  const a = first;
  if (a.type === 'bearer')
    return { type: 'bearer', bearer: [{ key: 'token', value: a.token, type: 'string' }] };
  if (a.type === 'basic')
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: a.username, type: 'string' },
        { key: 'password', value: a.password, type: 'string' },
      ],
    };
  if (a.type === 'apikey')
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: a.key, type: 'string' },
        { key: 'value', value: a.value, type: 'string' },
      ],
    };
  return undefined;
}