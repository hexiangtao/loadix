import { useTranslation } from 'react-i18next';
import { Sparkles, TextQuote } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';
import { MarkdownPreview } from './MarkdownPreview';
import sample from './markdown-sample.md?raw';

interface MarkdownToolProps {
  initialPayload?: string;
}

export function MarkdownTool({ initialPayload }: MarkdownToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('markdown.input', initialPayload ?? '');

  const showPreview = input.trim().length > 0;

  return (
    <ToolShell icon={TextQuote} title={t('tools.markdown.name')}>
      <div className="grid flex-1 grid-cols-2 gap-3 max-lg:grid-cols-1">
        <div className="flex min-h-0 flex-col">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-semibold text-muted">{t('tools.markdown.source')}</label>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setInput(sample)}
                className="ghost-btn flex items-center gap-1 px-2.5 py-1.5 text-xs"
                title={t('tools.markdown.sampleHint')}
              >
                <Sparkles size={13} />
                {t('tools.markdown.sample')}
              </button>
              <CopyButton text={input} />
            </div>
          </div>
          <textarea
            autoFocus
            className="min-h-[260px] w-full flex-1 resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="# 标题&#10;&#10;**加粗**、*斜体*、`代码`、[链接](https://loadix.dev)&#10;&#10;```mermaid&#10;flowchart LR&#10;  A --> B&#10;```"
          />
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-semibold text-muted">{t('tools.markdown.preview')}</label>
          </div>
          <div className="min-h-[260px] flex-1 overflow-auto rounded-lg border border-line bg-panel px-4 py-3">
            {showPreview ? (
              <MarkdownPreview source={input} />
            ) : (
              <span className="text-muted">{t('tools.markdown.empty')}</span>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}