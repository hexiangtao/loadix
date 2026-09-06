import { describe, expect, it } from 'vitest';
import type { RawResponse } from '@/engine/runner';
import { createApiRequest } from './apiTypes';
import { formatResponseAsMarkdown } from './responseToMarkdown';

describe('formatResponseAsMarkdown', () => {
  it('creates a readable request/response document and redacts secrets', () => {
    const request = createApiRequest();
    request.name = 'Create user';
    request.method = 'POST';
    request.url = 'https://api.example.com/users';
    const response: RawResponse = {
      status: 201,
      statusText: 'Created',
      ok: true,
      headers: [['content-type', 'application/json'], ['set-cookie', 'session=secret']],
      body: '{"id":42,"name":"Ada"}',
      ms: 128,
      bytes: 22,
      finalUrl: request.url,
      error: '',
      errorKind: '',
    };

    const markdown = formatResponseAsMarkdown(request, response, {
      method: 'POST',
      url: request.url,
      headers: [['Authorization', 'Bearer top-secret'], ['Content-Type', 'application/json']],
      body: '{"name":"Ada"}',
      timeout: 30_000,
    });

    expect(markdown).toContain('# Create user');
    expect(markdown).toContain('| Status | **201 Created** |');
    expect(markdown).toContain('```json\n{\n  "id": 42');
    expect(markdown).toContain('| Authorization | [redacted] |');
    expect(markdown).toContain('| set-cookie | [redacted] |');
    expect(markdown).not.toContain('top-secret');
    expect(markdown).not.toContain('session=secret');
  });

  it('chooses a fence longer than backticks in the payload', () => {
    const request = createApiRequest();
    request.url = 'https://example.com';
    const response: RawResponse = {
      status: 200,
      statusText: 'OK',
      ok: true,
      headers: [],
      body: 'text with ``` inside',
      ms: 4,
      bytes: 20,
      finalUrl: request.url,
      error: '',
      errorKind: '',
    };

    const markdown = formatResponseAsMarkdown(request, response);
    expect(markdown).toContain('````text');
    expect(markdown).toContain('text with ``` inside');
  });
});
