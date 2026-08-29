import { useTranslation } from 'react-i18next';
import type { ContentType, HttpMethod } from '@/shared/types';

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

  const updateHeader = (index: number, slot: 0 | 1, v: string) => {
    const headers = value.headers.map((h, i) =>
      i === index ? ([slot === 0 ? v : h[0], slot === 1 ? v : h[1]] as [string, string]) : h,
    );
    patch({ headers });
  };

  return (
    <section className="panel">
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
      <textarea
        className="field mt-3 min-h-28 w-full font-mono"
        value={value.body}
        spellCheck={false}
        onChange={(e) => patch({ body: e.target.value })}
      />
    </section>
  );
}
