/**
 * Journey run report → Markdown.
 *
 * Turns a JourneyRunReport into a self-contained Markdown document: run
 * summary, per-iteration per-step results with the actual wire request
 * (interpolated), response status/latency, extracted variables, assertion
 * failures, and a truncated response body snippet.
 */

import type { ApiRequest } from './apiTypes';
import { requestDisplayTitle } from './apiTypes';
import type { Journey } from './journeyTypes';
import type { JourneyRunReport } from './journeyRunner';

const BODY_SNIPPET_CHARS = 4000;
const BODY_LINES = 120;

interface ReportLabels {
  untitled: string;
  reportTitle: string;
  runAt: string;
  duration: string;
  cancelled: string;
  passed: string;
  failed: string;
  skipped: string;
  iteration: string;
  step: string;
  skippedLabel: string;
  request: string;
  url: string;
  method: string;
  headers: string;
  body: string;
  response: string;
  status: string;
  latency: string;
  extracted: string;
  assertionsFailed: string;
  attempts: string;
  error: string;
  dataError: string;
  iterationsTotal: string;
  noResponse: string;
}

export function journeyToMarkdown(
  journey: Journey,
  report: JourneyRunReport,
  requests: Record<string, ApiRequest>,
  labels: ReportLabels,
): string {
  const lines: string[] = [];
  lines.push(`# ${journey.name || labels.untitled}`);
  lines.push('');
  const fmtTime = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
  lines.push(`> ${labels.runAt}: ${fmtTime(report.startedAt)} · ${labels.duration}: ${report.totalMs} ms`);
  if (report.cancelled) lines.push(`> ${labels.cancelled}`);
  if (report.dataError) lines.push(`> ${labels.dataError}`);
  lines.push(`> ${labels.passed}: ${report.passedSteps} · ${labels.failed}: ${report.failedSteps} · ${labels.skipped}: ${report.skippedSteps}`);
  lines.push('');

  report.iterations.forEach((iteration, iterationIndex) => {
    const title = report.iterations.length > 1 ? `${labels.iteration} ${iterationIndex + 1}` : labels.reportTitle;
    lines.push(`## ${title}`);
    lines.push('');
    iteration.stepResults.forEach((step, stepIndex) => {
      const request = requests[step.requestId];
      const name = request ? requestDisplayTitle(request, labels.untitled) : step.requestId;
      const marker = step.skipped
        ? `[${labels.skipped}]`
        : step.error || (step.response && !step.response.ok) || step.assertionFailures.length > 0
          ? `[${labels.failed}]`
          : `[${labels.passed}]`;
      lines.push(`### ${marker} ${stepIndex + 1}. ${name}`);
      lines.push('');

      if (step.skipped) {
        lines.push(`> ${labels.skippedLabel}`);
        lines.push('');
        return;
      }

      if (step.sent) {
        lines.push(`**${labels.request}** — \`${step.sent.method} ${step.sent.url}\``);
        lines.push('');
        lines.push('```http');
        lines.push(`${step.sent.method} ${step.sent.url}`);
        for (const [key, value] of step.sent.headers) lines.push(`${key}: ${value}`);
        if (step.sent.body) {
          lines.push('');
          lines.push(step.sent.body);
        }
        lines.push('```');
        lines.push('');
      }

      if (step.response) {
        const response = step.response;
        lines.push(
          `**${labels.response}**: ${labels.status} \`${response.status} ${response.statusText}\` · ${labels.latency}: ${response.ms.toFixed(0)} ms` +
            (step.attempts > 1 ? ` · ${labels.attempts}: ${step.attempts}` : ''),
        );
        lines.push('');
        const snippet = response.body.length > BODY_SNIPPET_CHARS ? response.body.slice(0, BODY_SNIPPET_CHARS) : response.body;
        const pretty = prettifyJson(snippet);
        lines.push('```json');
        lines.push(truncateLines(pretty, BODY_LINES));
        lines.push('```');
        lines.push('');
      } else if (step.error) {
        lines.push(`**${labels.error}**: ${step.error}`);
        lines.push('');
      } else {
        lines.push(`> ${labels.noResponse}`);
        lines.push('');
      }

      if (step.extracted.length > 0) {
        lines.push(`**${labels.extracted}**: \`${step.extracted.join('`, `')}\``);
        lines.push('');
      }
      if (step.assertionFailures.length > 0) {
        lines.push(`**${labels.assertionsFailed}**: \`${step.assertionFailures.join('`, `')}\``);
        lines.push('');
      }
    });
  });

  if (report.iterations.length === 0) {
    lines.push(`_${labels.iterationsTotal}: 0_`);
    lines.push('');
  }

  return lines.join('\n');
}

function prettifyJson(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return [...lines.slice(0, maxLines), `… (${lines.length - maxLines} more lines)`].join('\n');
}