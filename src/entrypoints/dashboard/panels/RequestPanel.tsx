import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardPaste, X } from 'lucide-react';
import type { ContentType, HttpMethod } from '@/shared/types';
import { parseCurl } from '@/shared/curl';

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
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const CONTENT_TYPES: ContentType[] = ['application/json', 'application/x-www-form-urlencoded', 'text/plain'];

export function RequestPanel({ value, onChange }: RequestPanelProps) {
  const { t } = useTranslation();
  const patch = (partial: Partial<RequestFormValue>) => onChange({ ...value, ...partial });
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlText, setCurlText] = useState('');
  const [curlError, setCurlError] = useState<string | null>(null);

  // Close on Escape; the modal is overlay-only so we don't need to manage
  // focus traps — there's exactly one textarea to focus and the user can
  // dismiss with Esc or the cancel button.
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
        // timeout intentionally left to whatever the user already has
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

      <div className="mb-3.5 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
          {t('request.method')}
          <select className="field" value={value.method} onChange={(e) => patch({ method: e.target.value as HttpMethod })}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-xs font-semibold text-muted">
          {t('request.url')}
          <input
            className="field"
            value={value.url}
            placeholder={t('request.urlPlaceholder')}
            onChange={(e) => patch({ url: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
          {t('request.timeout')}
          <input
            className="field w-28"
            type="number"
            min={100}
            value={value.timeout}
            onChange={(e) => patch({ timeout: +e.target.value || 10000 })}
          />
        </label>
      </div>

      <div className="mb-1.5 mt-3.5 grid grid-cols-[1fr_1.5fr_36px] gap-2 text-[11px] font-bold text-muted">
        <span>Key</span>
        <span>Value</span>
        <span />
      </div>
      {value.headers.map(([k, v], i) => (
        <div className="mb-2 grid grid-cols-[1fr_1.5fr_36px] items-center gap-2" key={i}>
          <input
            className="field"
            placeholder={t('request.headerKey')}
            value={k}
            onChange={(e) => updateHeader(i, 0, e.target.value)}
          />
          <input
            className="field"
            placeholder={t('request.headerValue')}
            value={v}
            onChange={(e) => updateHeader(i, 1, e.target.value)}
          />
          <button className="icon-btn" onClick={() => patch({ headers: value.headers.filter((_, j) => j !== i) })}>
            ×
          </button>
        </div>
      ))}
      <button className="add-btn" onClick={() => patch({ headers: [...value.headers, ['', '']] })}>
        {t('request.addHeader')}
      </button>

      <label className="mt-3 flex max-w-80 flex-col gap-1.5 text-xs font-semibold text-muted">
        {t('request.contentType')}
        <select className="field" value={value.contentType} onChange={(e) => patch({ contentType: e.target.value as ContentType })}>
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
              className={`field min-h-28 w-full font-mono ${validationError ? 'border-danger focus:border-danger focus:ring-danger/25' : ''}`}
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
