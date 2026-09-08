import { describe, expect, it } from 'vitest';
import { journeyToMarkdown } from './journeyReport';
import { createJourney } from './journeyTypes';
import type { JourneyRunReport } from './journeyRunner';
import { createApiRequest, type ApiRequest } from './apiTypes';

const labels = {
  untitled: 'Untitled',
  reportTitle: 'Run report',
  runAt: 'Run at',
  duration: 'Duration',
  cancelled: 'Stopped by user',
  passed: 'Passed',
  failed: 'Failed',
  skipped: 'Skipped',
  iteration: 'Iteration',
  step: 'Step',
  skippedLabel: 'Step skipped by condition',
  request: 'Request',
  url: 'URL',
  method: 'Method',
  headers: 'Headers',
  body: 'Body',
  response: 'Response',
  status: 'Status',
  latency: 'Latency',
  extracted: 'Extracted',
  assertionsFailed: 'Assertions failed',
  attempts: 'Attempts',
  error: 'Error',
  dataError: 'Data error',
  iterationsTotal: 'Iterations',
  noResponse: 'No response',
};

function makeReport(): JourneyRunReport {
  return {
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_001_234,
    cancelled: false,
    iterations: [
      {
        nodeResults: [],
        stepResults: [
          {
            requestId: 'req-1',
            sent: {
              method: 'POST',
              url: 'https://api.example.com/login',
              headers: [
                ['Content-Type', 'application/json'],
                ['Authorization', 'Bearer abc123'],
              ],
              body: '{"user":"emilys"}',
              timeout: 30000,
            },
            response: {
              status: 200,
              statusText: 'OK',
              ok: true,
              headers: [['content-type', 'application/json']],
              body: '{"token":"abc123"}',
              ms: 87,
              bytes: 17,
              finalUrl: 'https://api.example.com/login',
              error: '',
              errorKind: '',
            },
            extracted: ['token'],
            extractedPairs: [['token', 'abc123']],
            assertionFailures: [],
            error: '',
            skipped: false,
            attempts: 1,
          },
          {
            requestId: 'req-2',
            sent: { method: 'GET', url: 'https://api.example.com/me', headers: [], timeout: 30000 },
            response: {
              status: 401,
              statusText: 'Unauthorized',
              ok: false,
              headers: [],
              body: '{"error":"bad token"}',
              ms: 33,
              bytes: 21,
              finalUrl: 'https://api.example.com/me',
              error: '',
              errorKind: '',
            },
            extracted: [],
            extractedPairs: [],
            assertionFailures: ['status: 200'],
            error: '',
            skipped: false,
            attempts: 1,
          },
        ],
        vars: {},
      },
    ],
    passedSteps: 1,
    failedSteps: 1,
    skippedSteps: 0,
    totalMs: 1234,
    dataError: '',
  };
}

describe('journeyToMarkdown', () => {
  it('renders summary, steps, wire request, response and failures', () => {
    const journey = createJourney('Login flow');
    const requests: Record<string, ApiRequest> = {
      'req-1': { ...createApiRequest(), name: 'Login', method: 'POST', url: 'https://api.example.com/login' },
      'req-2': { ...createApiRequest(), name: 'Me', url: 'https://api.example.com/me' },
    };
    const md = journeyToMarkdown(journey, makeReport(), requests, labels);

    expect(md).toContain('# Login flow');
    expect(md).toContain('Passed: 1 · Failed: 1 · Skipped: 0');
    expect(md).toContain('[Passed] 1. Login');
    expect(md).toContain('[Failed] 2. Me');
    expect(md).toContain('`POST https://api.example.com/login`');
    expect(md).toContain('Authorization: Bearer abc123');
    expect(md).toContain('Status `200 OK` · Latency: 87 ms');
    expect(md).toContain('**Extracted**: `token`');
    expect(md).toContain('**Assertions failed**: `status: 200`');
    expect(md).toContain('"token": "abc123"');
  });

  it('marks cancelled runs and prints skipped steps', () => {
    const journey = createJourney('Flow');
    const report: JourneyRunReport = {
      ...makeReport(),
      cancelled: true,
      iterations: [
        {
          nodeResults: [],
          stepResults: [
            {
              requestId: 'req-2',
              sent: null,
              response: null,
              extracted: [],
              extractedPairs: [],
              assertionFailures: [],
              error: '',
              skipped: true,
              attempts: 0,
            },
          ],
          vars: {},
        },
      ],
      skippedSteps: 1,
      passedSteps: 0,
      failedSteps: 0,
    };
    const requests: Record<string, ApiRequest> = {};
    const md = journeyToMarkdown(journey, report, requests, labels);
    expect(md).toContain('Stopped by user');
    expect(md).toContain('[Skipped] 1.');
    expect(md).toContain('Step skipped by condition');
  });

  it('falls back to URL-derived titles and escapes code fences', () => {
    const journey = createJourney('Flow');
    const report = makeReport();
    report.iterations[0]!.stepResults[0]!.sent!.body = '```js\nbroken\n```';
    report.iterations[0]!.stepResults[0]!.response!.body = '{"a":1}';
    const requests: Record<string, ApiRequest> = {
      'req-1': { ...createApiRequest(), name: '', method: 'GET', url: 'https://api.example.com/x' },
    };
    const md = journeyToMarkdown(journey, report, requests, labels);
    // The request name falls back to the URL path.
    expect(md).toContain('GET /x');
  });
});