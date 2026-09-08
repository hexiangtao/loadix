/**
 * OpenAPI 3.0.x import for the Requests module.
 *
 * Accepts YAML or JSON. Maps:
 *   - `info.title`  → root collection
 *   - `servers[].url` → suggested global variables (server1/baseUrl) so
 *     path templates keep working after import
 *   - `paths` + operations → requests (method, path with `{param}` kept as
 *     a variable reference `{{param}}`, query params, headers, JSON body)
 *   - `components.securitySchemes` → bearer / api-key / basic auth presets
 *   - operation-level or path-level `security` selects the scheme
 *
 * Not imported (skipped with a note): multipart bodies, $refs to
 * parameters/requestBodies outside components, webhooks, callbacks.
 */

import { load as yamlLoad } from 'js-yaml';
import type { ApiCollection, ApiRequest } from './apiTypes';
import { createApiCollection, createApiRequest } from './apiTypes';

export interface OpenApiImportResult {
  collections: ApiCollection[];
  requests: ApiRequest[];
  /** Global variables suggested by the spec (base URLs). */
  globalVars: [string, string][];
  skipped: string[];
}

interface SecurityScheme {
  type?: string;
  scheme?: string;
  name?: string;
  in?: string;
}

type SchemeMap = Record<string, SecurityScheme>;

export function parseOpenApiSpec(text: string): OpenApiImportResult {
  const result: OpenApiImportResult = { collections: [], requests: [], globalVars: [], skipped: [] };
  let spec: unknown;
  try {
    spec = JSON.parse(text);
  } catch {
    try {
      spec = yamlLoad(text);
    } catch (e) {
      throw new Error(`Not valid JSON or YAML — expected an OpenAPI 3.0 spec (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  if (!spec || typeof spec !== 'object') throw new Error('Not an OpenAPI spec — expected an object');
  const doc = spec as {
    openapi?: string;
    swagger?: string;
    info?: { title?: string };
    servers?: { url?: string; description?: string }[];
    paths?: Record<string, unknown>;
    components?: { securitySchemes?: SchemeMap };
  };
  if (!doc.paths || typeof doc.paths !== 'object') throw new Error('Not an OpenAPI spec — missing `paths`');
  if (!doc.openapi?.startsWith('3.') && !(doc.openapi ?? doc.swagger)?.startsWith('2.')) {
    throw new Error('Only OpenAPI 3.0.x (or Swagger 2.0) specs are supported');
  }

  const root = createApiCollection(doc.info?.title?.trim() || 'Imported API');
  result.collections.push(root);

  // Servers → suggested global variables. The first server becomes
  // `baseUrl`; extra servers get `server1`, `server2`, …
  const servers = (doc.servers ?? []).filter((s) => s.url?.trim());
  servers.forEach((server, i) => {
    const name = i === 0 ? 'baseUrl' : `server${i}`;
    result.globalVars.push([name, server.url!.trim().replace(/\/+$/, '')]);
  });

  const schemes = doc.components?.securitySchemes ?? {};

  for (const [path, rawItem] of Object.entries(doc.paths)) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Record<string, unknown> & { parameters?: unknown[]; security?: unknown[] };
    const pathSecurity = pickSecurityScheme(item.security, schemes);
    for (const [method, rawOp] of Object.entries(item)) {
      const httpMethod = method.toLowerCase();
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(httpMethod)) continue;
      if (!rawOp || typeof rawOp !== 'object') continue;
      const op = rawOp as {
        operationId?: string;
        summary?: string;
        description?: string;
        parameters?: unknown[];
        security?: unknown[];
        requestBody?: { content?: Record<string, { schema?: unknown }> };
      };
      const request = createApiRequest();
      request.method = method.toUpperCase() as ApiRequest['method'];
      request.url = buildUrl(path, servers);
      request.name = op.summary || op.operationId || `${method.toUpperCase()} ${path}`;
      request.collectionId = root.id;

      const security = pickSecurityScheme(op.security ?? item.security, schemes) ?? pathSecurity;
      if (security) {
        request.auth = security;
      }

      // Parameters: path-level + operation-level.
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])] as {
        name?: string;
        in?: string;
        required?: boolean;
        disabled?: boolean;
        schema?: { type?: string };
      }[];
      for (const p of params) {
        if (!p?.name) continue;
        if (p.in === 'query') request.params.push([p.name, p.required ? '{{' + p.name + '}}' : '']);
        else if (p.in === 'header') request.headers.push([p.name, '']);
      }

      // Request body: first JSON content-type wins; others are skipped.
      const content = op.requestBody?.content;
      if (content) {
        const jsonMedia = Object.entries(content).find(([ct]) => ct.includes('json'));
        const textMedia = Object.entries(content).find(([ct]) => ct.includes('text/plain'));
        if (jsonMedia) {
          request.body = { type: 'json', content: exampleForSchema(jsonMedia[1]?.schema), form: [], gqlVariables: '' };
        } else if (textMedia) {
          request.body = { type: 'text', content: '', form: [], gqlVariables: '' };
        } else {
          result.skipped.push(`${method.toUpperCase()} ${path}: body content-type not supported`);
        }
      }
      result.requests.push(request);
    }
  }

  if (result.requests.length === 0) {
    throw new Error('No operations found in the spec');
  }
  return result;
}

/** `/{id}/x` with a servers base → `{{baseUrl}}/{id}/x` (param → variable). */
function buildUrl(path: string, servers: { url?: string }[]): string {
  const base = servers[0]?.url?.trim().replace(/\/+$/, '') ?? '{{baseUrl}}';
  return `${base}${path}`;
}

/** Pick the first applicable security scheme referenced by a security block. */
function pickSecurityScheme(
  security: unknown,
  schemes: SchemeMap,
): ApiRequest['auth'] | null {
  if (!Array.isArray(security) || security.length === 0) return null;
  for (const block of security) {
    if (!block || typeof block !== 'object') continue;
    const name = Object.keys(block as Record<string, unknown>)[0];
    if (!name) continue;
    const scheme = schemes[name];
    if (!scheme) continue;
    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      return { type: 'bearer', token: '{{token}}', username: '', password: '', key: '', value: '' };
    }
    if (scheme.type === 'http' && scheme.scheme === 'basic') {
      return { type: 'basic', token: '', username: '{{username}}', password: '{{password}}', key: '', value: '' };
    }
    if (scheme.type === 'apiKey' && scheme.in === 'header' && scheme.name) {
      return { type: 'apikey', token: '', username: '', password: '', key: scheme.name, value: '{{apiKey}}' };
    }
  }
  return null;
}

/** Build a small JSON example from a schema (type, properties, items, enum). */
function exampleForSchema(schema: unknown): string {
  const build = (s: unknown): unknown => {
    if (!s || typeof s !== 'object') return null;
    const node = s as { type?: string; properties?: Record<string, unknown>; items?: unknown; enum?: unknown[]; example?: unknown; $ref?: string };
    if (node.example !== undefined) return node.example;
    if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0];
    switch (node.type) {
      case 'string':
        return 'string';
      case 'integer':
      case 'number':
        return 0;
      case 'boolean':
        return false;
      case 'array':
        return [build(node.items)];
      case 'object': {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node.properties ?? {})) out[k] = build(v);
        return out;
      }
      default: {
        if (node.properties) {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(node.properties)) out[k] = build(v);
          return out;
        }
        return null;
      }
    }
  };
  try {
    return JSON.stringify(build(schema), null, 2);
  } catch {
    return '{}';
  }
}

/** Postman-style error for callers that also try the Postman parser. */
export function isOpenApiSpec(text: string): boolean {
  try {
    const spec = JSON.parse(text) as { openapi?: string; swagger?: string };
    if (spec?.openapi?.startsWith('3.') || spec?.swagger) return true;
  } catch {
    /* YAML — try the real parse below */
  }
  try {
    const doc = yamlLoad(text) as { openapi?: string; swagger?: string };
    return Boolean(doc && (doc.openapi?.startsWith('3.') || doc.swagger));
  } catch {
    return false;
  }
}

