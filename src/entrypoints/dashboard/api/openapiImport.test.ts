import { describe, expect, it } from 'vitest';
import { exportOpenApiSpec } from './openapiExport';
import { parseOpenApiSpec } from './openapiImport';
import { createApiCollection, createApiRequest } from './apiTypes';

const SPEC_YAML = `
openapi: 3.0.0
info:
  title: Petstore
  version: 1.0.0
servers:
  - url: https://api.petstore.com/v1
paths:
  /pets:
    get:
      summary: List pets
      parameters:
        - name: limit
          in: query
          required: false
          schema: { type: integer }
    post:
      summary: Create pet
      security:
        - bearerAuth: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name: { type: string }
                age: { type: integer }
  /pets/{id}:
    get:
      summary: Get pet
      parameters:
        - name: id
          in: path
          required: true
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
`;

describe('parseOpenApiSpec', () => {
  it('maps title, servers, paths and operations', () => {
    const result = parseOpenApiSpec(SPEC_YAML);
    expect(result.collections[0]?.name).toBe('Petstore');
    expect(result.globalVars).toEqual([['baseUrl', 'https://api.petstore.com/v1']]);
    expect(result.requests).toHaveLength(3);
    const list = result.requests.find((r) => r.method === 'GET' && r.url.includes('/pets?') === false && r.url.includes('/pets') && !r.url.includes('{id}'));
    expect(list?.name).toBe('List pets');
    expect(list?.url).toBe('https://api.petstore.com/v1/pets');
    expect(list?.params).toEqual([['limit', '']]);
    const create = result.requests.find((r) => r.method === 'POST');
    expect(create?.auth.type).toBe('bearer');
    expect(create?.auth.token).toBe('{{token}}');
    expect(create?.body.type).toBe('json');
    const json = JSON.parse(create!.body.content) as Record<string, unknown>;
    expect(json.name).toBe('string');
    const byId = result.requests.find((r) => r.url.includes('{id}'));
    expect(byId?.url).toBe('https://api.petstore.com/v1/pets/{id}');
  });

  it('accepts JSON specs too', () => {
    const spec = JSON.stringify({ openapi: '3.0.0', info: { title: 'X' }, paths: { '/a': { get: { summary: 'A' } } } });
    const result = parseOpenApiSpec(spec);
    expect(result.requests[0]?.url).toBe('{{baseUrl}}/a');
    expect(result.requests[0]?.name).toBe('A');
  });

  it('throws for non-spec input', () => {
    expect(() => parseOpenApiSpec('{"foo": 1}')).toThrow();
    expect(() => parseOpenApiSpec('not json at all')).toThrow();
  });

  it('keeps path params as variable placeholders', () => {
    const result = parseOpenApiSpec(SPEC_YAML);
    const getPet = result.requests.find((r) => r.method === 'GET' && r.url.includes('{id}'));
    expect(getPet).toBeDefined();
  });
});

describe('exportOpenApiSpec', () => {
  it('produces a spec that re-imports cleanly', () => {
    const collection = createApiCollection('API');
    const request = createApiRequest();
    request.collectionId = collection.id;
    request.method = 'POST';
    request.name = 'Create user';
    request.url = 'https://api.example.com/users';
    request.headers = [['X-Trace', 'abc']];
    request.body = { type: 'json', content: '{"name":"tom"}', form: [], gqlVariables: '' };
    request.auth = { type: 'bearer', token: '{{token}}', username: '', password: '', key: '', value: '' };

    const spec = exportOpenApiSpec([collection], [request], 'API');
    const parsed = JSON.parse(spec) as { openapi: string; paths: Record<string, Record<string, unknown>>; components?: unknown };
    expect(parsed.openapi).toBe('3.0.0');
    const op = parsed.paths['/users']?.['post'] as { summary: string; security?: unknown[]; parameters?: unknown[] };
    expect(op.summary).toBe('Create user');
    expect(op.security).toEqual([{ bearerAuth: [] }]);
    expect(parsed.components).toBeDefined();
  });

  it('escapes variable placeholders into path templates', () => {
    const request = createApiRequest();
    request.url = '{{baseUrl}}/users/{{id}}';
    const spec = exportOpenApiSpec([], [request], 'T');
    const parsed = JSON.parse(spec) as { paths: Record<string, unknown> };
    expect(parsed.paths['/users/{id}']).toBeDefined();
  });
});