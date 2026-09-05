import { describe, expect, it } from 'vitest';
import { generateReport } from './report';
import type { MetricsSnapshot, TestConfig } from './types';

const baseConfig: TestConfig = {
  method: 'POST',
  url: 'https://api.example.com/orders',
  timeout: 10000,
  headers: [['Authorization', 'Bearer abc']],
  body: '{"id":1}',
  contentType: 'application/json',
  loadModel: 'constant',
  users: 10,
  rps: 5,
  duration: 30,
  ramp: 0,
  stepUsers: 10,
  stepDuration: 10,
  spikeUsers: 100,
  spikeDuration: 10,
  maxErrorRate: 0,
  maxP95: 0,
  assertions: [],
  variables: [],
};

const baseMetrics: MetricsSnapshot = {
  requests: 100,
  success: 95,
  errors: 5,
  rps: 3.3,
  avg: 90,
  p50: 80,
  p90: 120,
  p95: 200,
  p99: 400,
  max: 500,
  successRate: 95,
  statusBreakdown: { '200': 95, '500': 5 },
  recent: [],
  throughput: [1, 2, 3, 4, 5],
  latencySeries: [50, 60, 70, 80, 90],
  assertionFailures: { 'status:200': 5 },
  slowest: [{ status: 500, ms: 500, body: '', ok: false, error: '', pass: false, ts: Date.now() }],
  errorGroups: [{ message: 'NetworkError when attempting to fetch', count: 5, sample: { status: 0, ms: 0, body: 'err', ok: false, error: 'NetworkError when attempting to fetch', pass: false, ts: Date.now() } }],
};

describe('generateReport', () => {
  it('produces a complete HTML document', () => {
    const html = generateReport({
      generatedAt: new Date().toISOString(),
      config: baseConfig,
      metrics: baseMetrics,
    });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('</html>');
    expect(html).toContain('https://api.example.com/orders');
    // The header is rendered as `<b>Authorization:</b> Bearer abc` (key and
    // value in separate tags), so we look for each piece independently.
    expect(html).toContain('Authorization:');
    expect(html).toContain('Bearer abc');
  });

  it('escapes HTML in config values', () => {
    const html = generateReport({
      generatedAt: new Date().toISOString(),
      config: { ...baseConfig, url: 'https://x/<script>alert(1)</script>' },
      metrics: null,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('marks "ok" verdict when successRate is 100', () => {
    const html = generateReport({
      generatedAt: new Date().toISOString(),
      config: baseConfig,
      metrics: { ...baseMetrics, errors: 0, successRate: 100, success: 100, assertionFailures: {} },
    });
    expect(html).toContain('verdict-ok');
    expect(html).toContain('All thresholds passed');
  });

  it('marks "warn" verdict when there are failures but no auto-stop', () => {
    const html = generateReport({
      generatedAt: new Date().toISOString(),
      config: baseConfig,
      metrics: baseMetrics,
    });
    expect(html).toContain('verdict-warn');
  });

  it('marks "fail" verdict on auto-stop', () => {
    const html = generateReport({
      generatedAt: new Date().toISOString(),
      config: baseConfig,
      metrics: baseMetrics,
      resultMessage: 'auto-stop: p95',
    });
    expect(html).toContain('verdict-fail');
    expect(html).toContain('Auto-stopped: p95');
  });

  it('renders an SVG chart for throughput and latency', () => {
    const html = generateReport({
      generatedAt: new Date().toISOString(),
      config: baseConfig,
      metrics: baseMetrics,
    });
    const svgCount = (html.match(/<svg /g) ?? []).length;
    expect(svgCount).toBe(2); // throughput + latency
  });

  it('handles missing metrics gracefully', () => {
    const html = generateReport({
      generatedAt: new Date().toISOString(),
      config: baseConfig,
      metrics: null,
    });
    expect(html).toContain('No data');
    expect(html).toContain('verdict-muted');
  });

  it('clamps body previews to a safe length', () => {
    const html = generateReport({
      generatedAt: new Date().toISOString(),
      config: baseConfig,
      metrics: {
        ...baseMetrics,
        errorGroups: [{
          message: 'Oversized',
          count: 1,
          sample: { status: 0, ms: 0, body: 'x'.repeat(5000), ok: false, error: 'Oversized', pass: false, ts: 0 },
        }],
      },
    });
    expect(html).toContain('…');
    // No raw multi-KB payload should be in the report.
    expect(html.length).toBeLessThan(50_000);
  });
});
