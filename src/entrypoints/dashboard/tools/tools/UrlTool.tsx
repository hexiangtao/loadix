import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as LinkIcon } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

type Mode = 'encode' | 'decode';

interface UrlToolProps {
  initialPayload?: string;
}

export function UrlTool({ initialPayload }: UrlToolProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = usePersistedState('url.input', initialPayload ?? '');

  const output = useMemo(() => {
    if (!input) return '';
    try {
      return mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input.replace(/\+/g, ' '));
    } catch {
      return null;
    }
  }, [input, mode]);

  const error = input && output === null ? t('tools.url.invalid') : '';

  return (
    <ToolShell icon={LinkIcon} title={t('tools.url.name')}>
      <div className="mb-3 flex gap-1.5">
        {(['encode', 'decode'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-3.5 py-2 text-sm transition-colors duration-150 ${
              mode === m ? 'bg-primary/10 font-semibold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {t(`tools.url.${m}`)}
          </button>
        ))}
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.input')}</label>
      <textarea
        autoFocus
        className="min-h-[100px] w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="https://example.com/search?q=hello world&lang=zh"
      />

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <label className="text-xs font-semibold text-muted">{t('tools.output')}</label>
        {output && <CopyButton text={output} />}
      </div>
      <div className="min-h-[100px] w-full break-all rounded-lg border border-line bg-hover px-2.5 py-2 font-mono text-sm whitespace-pre-wrap">
        {output ?? ''}
      </div>
    </ToolShell>
  );
}
