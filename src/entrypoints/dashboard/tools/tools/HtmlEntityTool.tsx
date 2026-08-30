import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

type Mode = 'encode' | 'decode';

interface HtmlEntityToolProps {
  initialPayload?: string;
}

export function HtmlEntityTool({ initialPayload }: HtmlEntityToolProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = usePersistedState('htmlentity.input', initialPayload ?? '');

  const output = useMemo(() => {
    if (!input) return '';
    if (mode === 'encode') {
      return input.replace(/[&<>"']/g, (c: string) => `&#${c.charCodeAt(0)};`);
    }
    const doc = new DOMParser().parseFromString(input, 'text/html');
    return doc.documentElement.textContent ?? '';
  }, [input, mode]);

  return (
    <ToolShell icon={Code} title={t('tools.html.name')}>
      <div className="mb-3 flex gap-1.5">
        {(['encode', 'decode'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-3.5 py-2 text-sm transition-colors duration-150 ${
              mode === m ? 'bg-primary/10 font-semibold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {t(`tools.html.${m}`)}
          </button>
        ))}
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-muted">{t('tools.input')}</label>
      <textarea
        autoFocus
        className="min-h-[100px] w-full flex-1 resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={mode === 'encode' ? '<div class="hello">内容</div>' : '&lt;div&gt;内容&lt;/div&gt;'}
      />

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
