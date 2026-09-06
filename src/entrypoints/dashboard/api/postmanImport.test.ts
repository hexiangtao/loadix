import { describe, expect, it } from 'vitest';
import { exportPostmanCollection, parsePostmanCollection } from './postmanImport';

const FIXTURE = {
  info: { name: 'Petstore', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'Pets',
      auth: { type: 'bearer', bearer: [{ key: 'token', value: 'abc123', type: 'string' }] },
      item: [
        {
          name: 'List pets',
          request: {
            method: 'GET',
            header: [{ key: 'Accept', value: 'application/json' }],
            url: {
              raw: 'https://api.example.com/pets?limit=10',
              host: ['api', 'example', 'com'],
              path: ['pets'],
              query: [{ key: 'limit', value: '10' }],
            },
          },
        },
        {
          name: 'Create pet',
          request: {
            method: 'POST',
            header: [{ key: 'Accept', value: 'application/json' }, { key: 'X-Ignored', value: 'x', disabled: true }],
            body: { mode: 'raw', raw: '{"name":"tom"}', options: { raw: { language: 'json' } } },
            url: 'https://api.example.com/pets',
          },
        },
        {
          name: 'Upload (unsupported)',
          request: {
            method: 'POST',
            body: { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: '/tmp/a.png' }] },
            url: 'https://api.example.com/upload',
          },
        },
      ],
    },
    {
      name: 'Delete pet',
      request: { method: 'DELETE', url: 'https://api.example.com/pets/:id' },
    },
  ],
};

describe('parsePostmanCollection', () => {
  it('maps the root info.name to a root collection', () => {
    const result = parsePostmanCollection(JSON.stringify(FIXTURE));
    expect(result.collections[0]?.name).toBe('Petstore');
    expect(result.collections[0]?.parentId).toBeNull();
  });

  it('turns folders into nested collections', () => {
    const result = parsePostmanCollection(JSON.stringify(FIXTURE));
    const root = result.collections[0]!;
    const folder = result.collections.find((c) => c.parentId === root.id);
    expect(folder?.name).toBe('Pets');
  });

  it('maps requests with method, url and query params', () => {
    const result = parsePostmanCollection(JSON.stringify(FIXTURE));
    const list = result.requests.find((r) => r.name === 'List pets');
    expect(list?.method).toBe('GET');
    expect(list?.url).toBe('https://api.example.com/pets?limit=10');
    expect(list?.params).toEqual([['limit', '10']]);
  });

  it('inherits folder-level bearer auth and parses raw JSON bodies', () => {
    const result = parsePostmanCollection(JSON.stringify(FIXTURE));
    const create = result.requests.find((r) => r.name === 'Create pet');
    expect(create?.auth).toMatchObject({ type: 'bearer', token: 'abc123' });
    expect(create?.body).toMatchObject({ type: 'json', content: '{"name":"tom"}' });
    expect(create?.headers).toEqual([['Accept', 'application/json']]); // disabled header dropped
  });

  it('skips unsupported body modes with a reason', () => {
    const result = parsePostmanCollection(JSON.stringify(FIXTURE));
    expect(result.skipped.map((s) => s.name)).toContain('Upload (unsupported)');
    expect(result.skipped[0]?.reason).toMatch(/formdata/);
  });

  it('rejects non-JSON input', () => {
    expect(() => parsePostmanCollection('not json')).toThrow(/JSON/);
  });
});

describe('exportPostmanCollection', () => {
  it('round-trips through the parser', () => {
    const imported = parsePostmanCollection(JSON.stringify(FIXTURE));
    const json = exportPostmanCollection(imported.collections, imported.requests, 'Petstore');
    const reparsed = parsePostmanCollection(json);

    // Same tree shape: one root, one folder under it.
    expect(reparsed.collections.map((c) => c.name).sort()).toEqual(['Pets', 'Petstore']);
    expect(reparsed.requests.map((r) => r.name).sort()).toEqual(['Create pet', 'Delete pet', 'List pets']);

    const create = reparsed.requests.find((r) => r.name === 'Create pet');
    expect(create?.method).toBe('POST');
    expect(create?.url).toBe('https://api.example.com/pets');
    expect(create?.body.type).toBe('json');
  });
});