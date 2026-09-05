/**
 * Self-contained HTML report generator.
 *
 * Produces a single .html file that the user can email, archive, or open
 * offline in any browser. All CSS is inlined and all charts are inline SVG,
 * so there are no external dependencies and no broken links when the file
 * is detached from the Loadix extension.
 *
 * The shape is intentionally lean:
 *  - Header (title, verdict, timestamp, config summary)
 *  - Metrics grid (numbers)
 *  - Two SVG charts (throughput / sec, latency over time)
 *  - Status breakdown bar
 *  - Top-N slowest requests
 *  - Assertion failures
 *  - Error groups (with sample bodies)
 *  - Recent requests tail
 *
 * Numbers are pre-formatted server-side so the rendered file is plain HTML
 * with no JS needed.
 */

import type { MetricsSnapshot, TestConfig } from './types';

export interface ReportInput {
  generatedAt: string;        // ISO timestamp
  config: TestConfig;
  metrics: MetricsSnapshot | null;
  /** Optional reason string from the engine (`auto-stop: p95`, etc.). */
  resultMessage?: string;
}

/** Escape HTML-significant characters so config values are safe to embed. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Compact number formatter for chart Y-axis labels. */
function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(1);
}

/** Round a value up to the nearest "nice" 1/2/5 × 10^n number. */
function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const f = n / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}

/**
 * Render a line chart as inline SVG (no JS, no canvas). The viewBox is
 * fixed (300×80) so the chart scales with its container.
 */
function spark(values: number[], color: string, label: string): string {
  const W = 300;
  const H = 80;
  const padL = 26;
  const padR = 4;
  const padT = 4;
  const padB = 14;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  if (values.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#aaa" font-size="10">—</text></svg>`;
  }
  const max = niceCeil(Math.max(1, ...values));
  const xFor = (i: number) =>
    values.length === 1 ? padL : padL + (i * plotW) / (values.length - 1);
  const yFor = (v: number) => padT + plotH - (v / max) * plotH;

  let path = '';
  values.forEach((v, i) => {
    const x = xFor(i);
    const y = yFor(v);
    path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  });

  // Gridlines (4 divisions).
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH * i) / 4;
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#eee" stroke-width="0.5"/>`;
    const v = max * (1 - i / 4);
    grid += `<text x="${padL - 3}" y="${y + 3}" text-anchor="end" fill="#888" font-size="9">${fmt(v)}</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg">
    <text x="6" y="10" fill="#666" font-size="9" font-weight="600">${label}</text>
    ${grid}
    <path d="${path}" stroke="${color}" stroke-width="1.5" fill="none"/>
  </svg>`;
}

/**
 * Format a body preview, escaping HTML and clamping length so a 10 MB
 * response doesn't break the report file.
 */
function previewBody(body: string, max = 240): string {
  const slice = body.length > max ? body.slice(0, max) + '…' : body;
  return esc(slice);
}

function verdictClass(input: ReportInput): { cls: string; label: string } {
  if (!input.metrics || input.metrics.requests === 0) {
    return { cls: 'verdict-muted', label: 'No data' };
  }
  if (input.resultMessage?.startsWith('auto-stop:')) {
    return { cls: 'verdict-fail', label: `Auto-stopped: ${input.resultMessage.slice('auto-stop:'.length).trim()}` };
  }
  const hasFail = (input.metrics.errors ?? 0) > 0
    || Object.keys(input.metrics.assertionFailures ?? {}).length > 0
    || input.metrics.successRate < 100;
  return hasFail
    ? { cls: 'verdict-warn', label: 'Some thresholds failed' }
    : { cls: 'verdict-ok', label: 'All thresholds passed' };
}

function summaryCells(metrics: MetricsSnapshot | null): [string, string][] {
  return [
    ['Requests', String(metrics?.requests ?? 0)],
    ['Success', String(metrics?.success ?? 0)],
    ['Errors', String(metrics?.errors ?? 0)],
    ['RPS', (metrics?.rps ?? 0).toFixed(1)],
    ['Avg', `${(metrics?.avg ?? 0).toFixed(0)} ms`],
    ['P50', `${(metrics?.p50 ?? 0).toFixed(0)} ms`],
    ['P90', `${(metrics?.p90 ?? 0).toFixed(0)} ms`],
    ['P95', `${(metrics?.p95 ?? 0).toFixed(0)} ms`],
    ['P99', `${(metrics?.p99 ?? 0).toFixed(0)} ms`],
    ['Max', `${(metrics?.max ?? 0).toFixed(0)} ms`],
    ['Success Rate', `${(metrics?.successRate ?? 0).toFixed(1)}%`],
  ];
}

export function generateReport(input: ReportInput): string {
  const { config, metrics } = input;
  const verdict = verdictClass(input);

  const headersHtml = config.headers.length === 0
    ? '<em class="muted">none</em>'
    : `<ul class="kv-list">${config.headers.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join('')}</ul>`;

  const body = config.body;
  const bodyHtml = body.length === 0
    ? '<em class="muted">empty</em>'
    : `<pre class="code">${esc(body)}</pre>`;

  const cells = summaryCells(metrics);
  const cellsHtml = cells.map(([k, v]) => `<div class="cell"><span class="cell-label">${k}</span><span class="cell-value">${v}</span></div>`).join('');

  const throughputChart = spark(metrics?.throughput ?? [], '#2563eb', '/s');
  const latencyChart = spark(metrics?.latencySeries ?? [], '#16a34a', ' ms');

  // Status breakdown bar (max-relative).
  const breakdown = Object.entries(metrics?.statusBreakdown ?? {}).sort((a, b) => b[1] - a[1]);
  const bdMax = Math.max(1, ...breakdown.map(([, v]) => v));
  const breakdownHtml = breakdown.length === 0
    ? '<em class="muted">no requests</em>'
    : breakdown.map(([k, c]) => `<div class="bd-row"><span class="bd-label">${esc(k)}</span><div class="bd-bar"><i style="width:${(c / bdMax) * 100}%"></i></div><b class="bd-count">${c}</b></div>`).join('');

  // Slowest.
  const slowest = metrics?.slowest ?? [];
  const slowestHtml = slowest.length === 0
    ? '<em class="muted">no requests</em>'
    : `<table class="t"><thead><tr><th>#</th><th>Status / Error</th><th>Latency</th></tr></thead><tbody>${slowest.map((r, i) => `<tr><td>${i + 1}</td><td>${r.status || esc(r.error) || '—'}</td><td>${r.ms.toFixed(0)} ms</td></tr>`).join('')}</tbody></table>`;

  // Assertion failures.
  const assertions = Object.entries(metrics?.assertionFailures ?? {}).sort((a, b) => b[1] - a[1]);
  const assertionsHtml = assertions.length === 0
    ? '<em class="muted">no assertion failures</em>'
    : `<ul class="fail-list">${assertions.map(([k, c]) => `<li><b>${esc(k)}</b> · <span class="muted">${c}</span></li>`).join('')}</ul>`;

  // Error groups.
  const groups = metrics?.errorGroups ?? [];
  const groupsHtml = groups.length === 0
    ? '<em class="muted">no transport errors</em>'
    : groups.map((g) => `<div class="group"><div class="group-head"><span class="group-msg">${esc(g.message)}</span><b class="group-count">${g.count}</b></div>${g.sample?.body ? `<pre class="code small">${previewBody(g.sample.body)}</pre>` : ''}</div>`).join('');

  // Recent requests tail (cap at 30).
  const recent = (metrics?.recent ?? []).slice(0, 30);
  const recentHtml = recent.length === 0
    ? '<em class="muted">no requests</em>'
    : `<table class="t"><thead><tr><th>Time</th><th>Result</th><th>Status</th><th>Latency</th></tr></thead><tbody>${recent.map((r) => `<tr><td>${esc(new Date(r.ts).toLocaleTimeString())}</td><td class="${r.pass ? 'ok' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</td><td>${r.status || esc(r.error) || '—'}</td><td>${r.ms.toFixed(0)} ms</td></tr>`).join('')}</tbody></table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Loadix Report · ${esc(new Date(input.generatedAt).toLocaleString())}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1d1d1f; background: #f5f5f7; margin: 0; padding: 24px; }
  main { max-width: 920px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; color: #444; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700; }
  .muted { color: #888; }
  .header { background: #fff; border: 1px solid #e3e3e6; border-radius: 12px; padding: 20px; }
  .verdict { display: inline-block; padding: 4px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; margin-top: 8px; }
  .verdict-ok { background: #dcfce7; color: #166534; }
  .verdict-warn { background: #fef3c7; color: #92400e; }
  .verdict-fail { background: #fee2e2; color: #991b1b; }
  .verdict-muted { background: #e5e5e7; color: #444; }
  .config { display: grid; grid-template-columns: 110px 1fr; gap: 4px 12px; margin-top: 12px; font-size: 13px; }
  .config dt { color: #888; font-weight: 600; }
  .config dd { margin: 0; word-break: break-all; }
  .panel { background: #fff; border: 1px solid #e3e3e6; border-radius: 12px; padding: 16px 20px; margin-top: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
  .cell { background: #fafafa; border: 1px solid #e3e3e6; border-radius: 8px; padding: 8px 10px; }
  .cell-label { display: block; font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 0.04em; }
  .cell-value { display: block; font-size: 15px; font-weight: 700; margin-top: 2px; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 640px) { .charts { grid-template-columns: 1fr; } }
  .chart-card { border: 1px solid #e3e3e6; border-radius: 8px; padding: 10px; background: #fafafa; }
  .chart-svg { width: 100%; height: auto; display: block; }
  .chart-cap { font-size: 11px; color: #888; margin-top: 6px; }
  .bd-row { display: grid; grid-template-columns: 90px 1fr 50px; gap: 8px; align-items: center; font-size: 12px; padding: 3px 0; }
  .bd-label { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .bd-bar { height: 8px; background: #eee; border-radius: 4px; overflow: hidden; }
  .bd-bar i { display: block; height: 100%; background: #2563eb; border-radius: 4px; }
  .bd-count { text-align: right; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .t { width: 100%; border-collapse: collapse; font-size: 12px; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .t th, .t td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  .t th { color: #888; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; }
  .t td.ok { color: #166534; font-weight: 600; }
  .t td.fail { color: #991b1b; font-weight: 600; }
  .code { background: #f5f5f7; border: 1px solid #e3e3e6; border-radius: 6px; padding: 10px; font: 12px/1.5 ui-monospace, "SF Mono", Menlo, monospace; white-space: pre-wrap; word-break: break-all; max-height: 240px; overflow: auto; margin: 0; }
  .code.small { max-height: 120px; font-size: 11px; }
  .kv-list { margin: 0; padding-left: 16px; font-size: 12px; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .fail-list { margin: 0; padding-left: 18px; font-size: 13px; }
  .group { border: 1px solid #e3e3e6; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; background: #fafafa; }
  .group-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .group-msg { font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace; color: #991b1b; word-break: break-word; }
  .group-count { font: 12px ui-monospace, "SF Mono", Menlo, monospace; color: #991b1b; background: #fee2e2; padding: 2px 6px; border-radius: 4px; }
  footer { text-align: center; color: #aaa; font-size: 11px; margin-top: 32px; }
</style>
</head>
<body>
<main>
  <div class="header">
    <h1>${esc(config.method)} ${esc(config.url)}</h1>
    <div class="muted">Generated ${esc(new Date(input.generatedAt).toLocaleString())}</div>
    <div class="verdict ${verdict.cls}">${esc(verdict.label)}</div>
    <dl class="config">
      <dt>Load model</dt><dd>${esc(config.loadModel)} · ${config.users} VUs · ${config.rps} RPS · ${config.duration}s${config.ramp ? ` (ramp ${config.ramp}s)` : ''}</dd>
      <dt>Auto-stop</dt><dd>${config.maxErrorRate ? `error &gt; ${config.maxErrorRate}%` : 'off'} · ${config.maxP95 ? `P95 &gt; ${config.maxP95}ms` : 'off'}</dd>
      <dt>Timeout</dt><dd>${config.timeout} ms</dd>
      <dt>Content-Type</dt><dd>${esc(config.contentType)}</dd>
      <dt>Headers</dt><dd>${headersHtml}</dd>
      <dt>Body</dt><dd>${bodyHtml}</dd>
    </dl>
  </div>

  <div class="panel">
    <h2>Metrics</h2>
    <div class="grid">${cellsHtml}</div>
  </div>

  <div class="panel">
    <h2>Charts</h2>
    <div class="charts">
      <div class="chart-card">${throughputChart}<div class="chart-cap">Throughput / sec</div></div>
      <div class="chart-card">${latencyChart}<div class="chart-cap">Latency over time</div></div>
    </div>
  </div>

  <div class="panel">
    <h2>Status / Error Breakdown</h2>
    ${breakdownHtml}
  </div>

  <div class="panel">
    <h2>Slowest Requests</h2>
    ${slowestHtml}
  </div>

  <div class="panel">
    <h2>Assertion Failures</h2>
    ${assertionsHtml}
  </div>

  <div class="panel">
    <h2>Error Groups</h2>
    ${groupsHtml}
  </div>

  <div class="panel">
    <h2>Recent Requests</h2>
    ${recentHtml}
  </div>

  <footer>Generated by Loadix · ${esc(new Date(input.generatedAt).toISOString())}</footer>
</main>
</body>
</html>`;
}
