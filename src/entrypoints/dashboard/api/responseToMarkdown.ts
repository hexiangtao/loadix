import type { RawRequest, RawResponse } from '@/engine/runner';
import type { ApiRequest } from './apiTypes';
import { requestDisplayTitle } from './apiTypes';

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|token|secret)$/i;

/** Build a documentation-ready Markdown snapshot without exposing credentials. */
export function formatResponseAsMarkdown(request: ApiRequest, response: RawResponse, rawRequest?: RawRequest): string {
  const title = requestDisplayTitle(request, 'API request');
  const wire = rawRequest ?? {
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body.type === 'none' ? undefined : request.body.content,
    timeout: 0,
  };
  const status = response.status > 0 ? `${response.status}${response.statusText ? ` ${response.statusText}` : ''}` : 'Request failed';
  const requestBody = wire.body?.trim();
  const responseBody = response.body.trim();
  const responseJson = parseJson(responseBody);
  const responseContent = responseJson === undefined ? response.body : JSON.stringify(responseJson, null, 2);
  const responseLanguage = responseJson === undefined ? 'text' : 'json';
  const requestLanguage = requestBody && looksLikeJson(requestBody) ? 'json' : 'text';

  const sections = [
    `# ${escapeHeading(title)}`,
    '',
    '> Captured with Loadix Requests',
    '',
    '## Result',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Status | **${escapeTable(status)}** |`,
    `| Method | \`${escapeInline(wire.method)}\` |`,
    `| Response time | ${response.ms.toFixed(0)} ms |`,
    `| Payload | ${formatBytes(response.bytes)} |`,
    '',
    '## Request',
    '',
    `\`${escapeInline(wire.method)}\` ${escapeUrl(wire.url)}`,
    '',
    formatHeaders('Request headers', wire.headers),
    requestBody ? `### Body\n\n${fenced(requestBody, requestLanguage)}` : '',
    '',
    '## Response',
    '',
    formatHeaders('Response headers', response.headers),
    responseContent ? `### Body\n\n${fenced(responseContent, responseLanguage)}` : '### Body\n\n_Empty response body._',
  ];

  return `${sections.filter((section) => section.length > 0).join('\n')}\n`;
}

function formatHeaders(title: string, headers: [string, string][]): string {
  if (headers.length === 0) return `### ${title}\n\n_No headers captured._`;
  const rows = headers.map(([key, value]) => `| ${escapeTable(key)} | ${escapeTable(redactHeader(key, value))} |`);
  return [`### ${title}`, '', '| Header | Value |', '| --- | --- |', ...rows].join('\n');
}

function redactHeader(key: string, value: string): string {
  return SENSITIVE_HEADER.test(key) ? '[redacted]' : value;
}

function parseJson(value: string): unknown | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function looksLikeJson(value: string): boolean {
  const parsed = parseJson(value);
  return parsed !== undefined;
}

function fenced(value: string, language: string): string {
  const longestRun = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${value}\n${fence}`;
}

function escapeHeading(value: string): string {
  return value.replace(/[\r\n]/g, ' ').replace(/^#+\s*/, '').trim();
}

function escapeInline(value: string): string {
  return value.replace(/`/g, '\\`').replace(/[\r\n]/g, ' ');
}

function escapeUrl(value: string): string {
  return value.replace(/[\r\n]/g, ' ').replace(/\|/g, '\\|');
}

function escapeTable(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
