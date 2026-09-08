/**
 * OpenAPI 3.0.0 export for the Requests module.
 *
 * Collections → tags, requests → paths/operations. Each request becomes a
 * single operation under its method; query params and headers map to
 * `parameters`, JSON bodies to `requestBody`, auth to security schemes.
 *
 * The output is intentionally readable rather than exhaustive — this is a
 * starting point for teams that keep their API source of truth in the
 * Requests workspace and want a shareable spec.
 */

import type { ApiCollection, ApiRequest } from './apiTypes';

export function exportOpenApiSpec(collections: ApiCollection[], requests: ApiRequest[], title: string): string {
  const rootCollections = collections.filter((c) => c.parentId === null);
  const collectionById = new Map(collections.map((c) => [c.id, c]));
  const tagFor = (r: ApiRequest): string | undefined => {
    if (!r.collectionId) return undefined;
    const c = collectionById.get(r.collectionId);
    if (!c) return undefined;
    if (c.parentId === null) return c.name;
    const parent = collectionById.get(c.parentId);
    return parent ? `${parent.name} / ${c.name}` : c.name;
  };

  const paths: Record<string, Record<string, unknown>> = {};
  const securitySchemes: Record<string, unknown> = {};

  const splitUrl = (url: string): { base: string; path: string } => {
    try {
      const u = new URL(url);
      // Guard: a variable-only "host" like `{{baseUrl}}` parses as a scheme
      // and yields a nonsense origin — fall back to the placeholder base.
      if (u.origin && u.origin !== 'null' && !u.origin.includes('{')) {
        return { base: u.origin, path: u.pathname + u.search };
      }
    } catch {
      /* fall through */
    }
    return { base: '{{baseUrl}}', path: url.replace(/^\{\{\s*[\w.-]+\s*\}\}\/?/, '/') };
  };

  for (const request of requests) {
    if (!request.url.trim()) continue;
    const { base, path: rawPath } = splitUrl(request.url);
    const serverUrl = base.startsWith('http') ? base : undefined;
    // Path templates: `{{id}}` and `:id` both become OpenAPI `{id}`.
    const path = rawPath.replace(/\{\{\s*([\w.-]+)\s*\}\}|:([\w.-]+)/g, (_, a?: string, b?: string) => `{${a ?? b}}`);
    const method = request.method.toLowerCase();
    const op: Record<string, unknown> = {
      operationId: request.name || `${request.method} ${path}`,
      summary: request.name || `${request.method} ${path}`,
    };
    const tag = tagFor(request);
    if (tag) op.tags = [tag];
    const parameters: Record<string, unknown>[] = [];
    // Query params from the URL query string.
    try {
      const u = new URL(request.url);
      for (const [key, value] of u.searchParams) {
        if (!key) continue;
        parameters.push({ name: key, in: 'query', required: Boolean(value), schema: { type: 'string' }, example: value || undefined });
      }
    } catch {
      /* relative URLs without query — fine */
    }
    for (const [name, value] of request.headers) {
      if (!name.trim() || name.toLowerCase() === 'content-type') continue;
      parameters.push({ name, in: 'header', required: Boolean(value), schema: { type: 'string' }, example: value || undefined });
    }
    if (parameters.length > 0) op.parameters = parameters;

    if (request.body.type === 'json' || request.body.type === 'graphql') {
      op.requestBody = {
        content: { 'application/json': { example: parseJsonish(request.body.content) } },
      };
    } else if (request.body.type === 'form') {
      op.requestBody = {
        content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: Object.fromEntries(request.body.form.filter(([k]) => k.trim()).map(([k]) => [k, { type: 'string' }])) } } },
      };
    } else if (request.body.type === 'text' && request.body.content.trim()) {
      op.requestBody = { content: { 'text/plain': { example: request.body.content } } };
    }

    if (request.auth.type === 'bearer' && request.auth.token.trim()) {
      securitySchemes.bearerAuth = { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' };
      op.security = [{ bearerAuth: [] }];
    } else if (request.auth.type === 'basic') {
      securitySchemes.basicAuth = { type: 'http', scheme: 'basic' };
      op.security = [{ basicAuth: [] }];
    } else if (request.auth.type === 'apikey' && request.auth.key.trim()) {
      securitySchemes.apiKeyAuth = { type: 'apiKey', in: 'header', name: request.auth.key };
      op.security = [{ apiKeyAuth: [] }];
    }

    paths[path] = paths[path] ?? {};
    (paths[path] as Record<string, unknown>)[method] = op;
  }

  const doc: Record<string, unknown> = {
    openapi: '3.0.0',
    info: {
      title: title || 'API',
      version: '1.0.0',
      description: 'Exported from Loadix Requests',
    },
    servers: [{ url: serverUrlOrPlaceholder(requests) }],
    paths,
  };
  if (Object.keys(securitySchemes).length > 0) {
    doc.components = { securitySchemes };
  }
  return JSON.stringify(doc, null, 2);
}

function serverUrlOrPlaceholder(requests: ApiRequest[]): string {
  for (const request of requests) {
    try {
      const u = new URL(request.url);
      if (u.origin && u.origin !== 'null') return u.origin;
    } catch {
      /* keep looking */
    }
  }
  return 'https://api.example.com';
}

function parseJsonish(content: string): unknown {
  if (!content.trim()) return {};
  try {
    return JSON.parse(content);
  } catch {
    return { raw: content.slice(0, 200) };
  }
}

/** Postman-style error for callers that also try the Postman parser. */
export function downloadOpenApiSpec(spec: string, filename: string): void {
  const blob = new Blob([spec], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}