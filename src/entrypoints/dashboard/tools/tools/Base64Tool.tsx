import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Binary } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

type Mode = 'encode' | 'decode';

interface Base64ToolProps {
  /** Content routed from the smart-paste box (pre-fills the input). */
  initialPayload?: string;
}

export function Base64Tool({ initialPayload }: Base64ToolProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = usePersistedState('base64.input', initialPayload ?? '');

  const output = useMemo(() => {
    if (!input) return '';
    try {
      if (mode === 'encode') {
        return btoa(unescape(encodeURIComponent(input)));
      }
      // Decode: strip whitespace/newlines, tolerate missing padding.
      const cleaned = input.replace(/\s+/g, '');
      const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
      return decodeURIComponent(escape(atob(padded)));
    } catch {
      return null;
    }
  }, [input, mode]);

  const error = input && output === null ? t('tools.base64.invalid') : '';

  return (
    <ToolShell icon={Binary} title={t('tools.base64.name')}>
      <div className="mb-3 flex gap-1.5">
        {(['encode', 'decode'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-3.5 py-2 text-sm transition-colors duration-150 ${
              mode === m ? 'bg-primary/10 font-semibold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {t(`tools.base64.${m}`)}
          </button>
        ))}
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-muted">
        {mode === 'encode' ? t('tools.input') : t('tools.base64.input')}
      </label>
      <textarea
        autoFocus
        className="field min-h-[120px] w-full flex-1 resize-y font-mono text-sm"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={mode === 'encode' ? t('tools.base64.placeholder') : 'SGVsbG8gV29ybGQ='}
      />

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <label className="text-xs font-semibold text-muted">
          {mode === 'encode' ? t('tools.base64.encoded') : t('tools.base64.decoded')}
        </label>
        {output && <CopyButton text={output} />}
      </div>
      <div className="field mt-1.5 min-h-[120px] w-full flex-1 break-all bg-hover font-mono text-sm whitespace-pre-wrap">
        {output ?? ''}
      </div>
    </ToolShell>
  );
}
