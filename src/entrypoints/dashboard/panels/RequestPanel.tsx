import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardPaste, Copy, Check, X } from 'lucide-react';
import type { ContentType, HttpMethod, TestConfig } from '@/shared/types';
import type { EngineHost } from '@/engine/engine-host';
import type { ProbeResult } from '@/engine/runner';
import { parseCurl, toCurl } from '@/shared/curl';
import { ConnectionProbe, ProbeCard } from '../components/ConnectionProbe';

export interface RequestFormValue {
  method: HttpMethod;
  url: string;
  timeout: number;
  headers: [string, string][];
  body: string;
  contentType: ContentType;
}

interface RequestPanelProps {
  value: RequestFormValue;
  onChange: (value: RequestFormValue) => void;
  /** EngineHost is injected so the panel can fire a single-shot
   *  connectivity probe without owning the load engine lifecycle. */
  host: EngineHost;
  /** Variable form values, used to interpolate the URL/headers/body for
   *  the probe exactly as the real run would. */
  variables: [string, string][];
  /** True while the engine is running — disables the probe to avoid
   *  competing for host resources. */
  busy?: boolean;
}

const CONTENT_TYPES: ContentType[] = ['application/json', 'application/x-www-form-urlencoded', 'text/plain'];

/**
 * Request *details* panel — Method, URL, Timeout and the primary Start
 * action live in <TargetBar /> above the live results. This panel keeps
 * the things that configure the actual request payload:
 *
 *   - HTTP headers (Key / Value rows)
 *   - Content-Type select
 *   - Request body (with JSON / form validation, Format JSON button)
 *   - Paste cURL  → import a curl command into the whole form
 *   - Copy as cURL → export the current form as a curl command
 *   - Test Connection → single-shot probe (verifies URL + headers + body
 *     reach the server before kicking off a real run)
 */
export function RequestPanel({ value, onChange, host, variables, busy }: RequestPanelProps) {
  const { t } = useTranslation();
  const patch = (partial: Partial<RequestFormValue>) => onChange({ ...value, ...partial });
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlText, setCurlText] = useState('');
  const [curlError, setCurlError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Probe result is owned by the parent so <ProbeCard /> can render at
  // panel width (not at the half-width of the trigger button row).
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);

  // Build a TestConfig shell from the current form. The same shell is
  // reused by the Copy-as-cURL button, the Test Connection probe, and
  // any future "share" action, so the field set stays consistent.
  const buildConfig = useCallback((): TestConfig => ({
    method: value.method,
    url: value.url,
    timeout: value.timeout,
    headers: value.headers,
    body: value.body,
    contentType: value.contentType,
    loadModel: 'constant',
    users: 1,
    rps: 0,
    duration: 1,
    ramp: 0,
    stepUsers: 0,
    stepDuration: 0,
    spikeUsers: 0,
    spikeDuration: 0,
    maxErrorRate: 0,
    maxP95: 0,
    assertions: [],
    variables,
  }), [value, variables]);

  // Close the cURL modal on Escape.
  useEffect(() => {
    if (!curlOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCurlOpen(false);
        setCurlError(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [curlOpen]);

  const applyCurl = () => {
    try {
      const parsed = parseCurl(curlText);
      onChange({
        method: parsed.method,
        url: parsed.url,
        headers: parsed.headers.length > 0 ? parsed.headers : value.headers,
        body: parsed.body,
        contentType: parsed.contentType,
        // timeout intentionally left to whatever the user already has;
        // cURL's `--max-time` isn't surfaced by the parser today.
        timeout: value.timeout,
      });
      setCurlOpen(false);
      setCurlText('');
      setCurlError(null);
    } catch (e) {
      setCurlError(e instanceof Error ? e.message : String(e));
    }
  };

  const updateHeader = (index: number, slot: 0 | 1, v: string) => {
    const headers = value.headers.map(
      (h, i): [string, string] =>
        i === index ? ([slot === 0 ? v : h[0], slot === 1 ? v : h[1]] as [string, string]) : h,
    );
    patch({ headers });
  };

  return (
    <section className="panel">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t('nav.request')}</span>
        <button
          type="button"
          className="ghost-btn flex items-center gap-1.5 text-[11px]"
          onClick={() => setCurlOpen(true)}
        >
          <ClipboardPaste size={12} />
          {t('request.pasteCurl')}
        </button>
      </div>

      {/* Header rows. The grid uses `1fr 1.8fr 28px` so the Value column
          can fit `application/json` and `Bearer {{token}}` at the 296px
          panel width without wrapping. `min-w-0` on each input lets the
          Value column clip long content with overflow rather than
          stretching the row into a horizontal scroll. */}
      <div className="mb-1.5 grid grid-cols-[1fr_1.8fr_28px] gap-1.5 text-[11px] font-bold text-muted">
        <span>Key</span>
        <span>Value</span>
        <span />
      </div>
      {value.headers.map(([k, v], i) => (
        <div className="mb-1.5 grid grid-cols-[1fr_1.8fr_28px] items-center gap-1.5" key={i}>
          <input
            className="field min-w-0 text-[12px]"
            placeholder={t('request.headerKey')}
            value={k}
            onChange={(e) => updateHeader(i, 0, e.target.value)}
          />
          <input
            className="field min-w-0 text-[12px]"
            placeholder={t('request.headerValue')}
            value={v}
            onChange={(e) => updateHeader(i, 1, e.target.value)}
          />
          <button
            className="icon-btn"
            onClick={() => patch({ headers: value.headers.filter((_, j) => j !== i) })}
            title="Remove"
            aria-label="Remove header"
          >
            ×
          </button>
        </div>
      ))}
      <button className="add-btn" onClick={() => patch({ headers: [...value.headers, ['', '']] })}>
        {t('request.addHeader')}
      </button>

      <label className="mt-3 flex max-w-80 flex-col gap-1.5 text-xs font-semibold text-muted">
        {t('request.contentType')}
        <select
          className="field"
          value={value.contentType}
          onChange={(e) => patch({ contentType: e.target.value as ContentType })}
        >
          {CONTENT_TYPES.map((ct) => (
            <option key={ct}>{ct}</option>
          ))}
        </select>
      </label>

      {(() => {
        const showBody = value.method !== 'GET' && value.method !== 'HEAD';
        if (!showBody) {
          return (
            <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2 text-[11px] text-muted">
              {t('request.bodyHintNoBody')}
            </div>
          );
        }
        const trimmed = value.body.trim();
        const isJson = value.contentType === 'application/json';
        const isForm = value.contentType === 'application/x-www-form-urlencoded';
        const looksLikeJson = isJson && trimmed.length > 0;
        let validationError: string | null = null;
        if (looksLikeJson) {
          try {
            JSON.parse(trimmed);
          } catch {
            validationError = t('request.bodyInvalidJson');
          }
        } else if (isForm && trimmed.length > 0) {
          try {
            new URLSearchParams(trimmed);
          } catch {
            validationError = t('request.bodyInvalidForm');
          }
        }
        return (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted">
                {t('request.body')} <span className="opacity-60">({value.contentType})</span>
              </span>
              {isJson && trimmed.length > 0 && (
                <button
                  type="button"
                  className="ghost-btn text-[11px]"
                  disabled={!!validationError}
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(trimmed);
                      patch({ body: JSON.stringify(parsed, null, 2) });
                    } catch {
                      /* noop */
                    }
                  }}
                >
                  {t('request.formatJson')}
                </button>
              )}
            </div>
            <textarea
              className={`field min-h-28 w-full font-mono ${
                validationError ? 'border-danger focus:border-danger focus:ring-danger/25' : ''
              }`}
              value={value.body}
              spellCheck={false}
              onChange={(e) => patch({ body: e.target.value })}
            />
            {validationError && (
              <div className="mt-1.5 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-[11px] font-medium text-danger">
                {validationError}
              </div>
            )}
          </div>
        );
      })()}

      {/* Action row: Copy as cURL · Test Connection.
          The grid keeps the two triggers on a single line at every
          panel width. The ProbeCard is rendered *outside* the grid so
          it can stretch to the panel's full width instead of being
          squeezed into a half-width column. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!value.url.trim()}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(toCurl(buildConfig()));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            } catch {
              /* clipboard unavailable — silently ignore. */
            }
          }}
          className="ghost-btn inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
          title={t('request.copyCurlHint')}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t('request.copyCurlCopied') : t('request.copyCurl')}
        </button>
        <ConnectionProbe
          disabled={busy || !value.url.trim().startsWith('http')}
          run={() => host.probe(buildConfig())}
          onResult={(s) => setProbeResult(s.status === 'done' ? s.result : null)}
        />
      </div>

      {/* Probe result card at full panel width, below the trigger row.
          A hairline separator + extra top padding makes the card feel
          like a distinct block rather than a tightly-stacked second row. */}
      {probeResult && (
        <div className="mt-4 border-t border-line/60 pt-3.5">
          <ProbeCard result={probeResult} onDismiss={() => setProbeResult(null)} />
        </div>
      )}

      {curlOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            setCurlOpen(false);
            setCurlError(null);
          }}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-line bg-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-bold">{t('request.pasteCurlTitle')}</h3>
              <button
                className="icon-btn"
                onClick={() => {
                  setCurlOpen(false);
                  setCurlError(null);
                }}
                aria-label={t('request.pasteCurlCancel')}
              >
                <X size={14} />
              </button>
            </div>
            <textarea
              className="field min-h-32 w-full font-mono text-[12px]"
              placeholder={t('request.pasteCurlPlaceholder')}
              value={curlText}
              onChange={(e) => {
                setCurlText(e.target.value);
                if (curlError) setCurlError(null);
              }}
              autoFocus
              spellCheck={false}
            />
            <div className="mt-2 text-[11px] leading-relaxed text-muted">{t('request.pasteCurlHint')}</div>
            {curlError && (
              <div className="mt-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-[11px] font-medium text-danger">
                {curlError}
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="nav-btn"
                onClick={() => {
                  setCurlOpen(false);
                  setCurlError(null);
                }}
              >
                {t('request.pasteCurlCancel')}
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={applyCurl}
                disabled={curlText.trim().length === 0}
              >
                {t('request.pasteCurlApply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
