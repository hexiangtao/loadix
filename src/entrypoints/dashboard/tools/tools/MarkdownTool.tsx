import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Columns2, Eye, PencilLine, Sparkles, TextQuote, type LucideIcon } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';
import { MarkdownPreview } from './MarkdownPreview';
import sample from './markdown-sample.md?raw';

interface MarkdownToolProps {
  initialPayload?: string;
}

type ViewMode = 'split' | 'edit' | 'preview';

/**
 * Rendering is width-hungry (diagrams, tables, side-by-side diffs), so the tool
 * offers three view modes: split (source + preview side by side), edit (source
 * only, full width) and preview (rendered output only — the whole tool area
 * goes to the renderer). The choice persists across sessions.
 */
const VIEW_MODES: { id: ViewMode; icon: LucideIcon; labelKey: string }[] = [
  { id: 'split', icon: Columns2, labelKey: 'tools.markdown.modeSplit' },
  { id: 'edit', icon: PencilLine, labelKey: 'tools.markdown.modeEdit' },
  { id: 'preview', icon: Eye, labelKey: 'tools.markdown.modePreview' },
];

const VIEW_MODE_KEY = 'loadix-tool:markdown.viewMode';

/**
 * View mode persisted directly: usePersistedState's "initial payload wins"
 * semantics can't distinguish a truthy default ('split') from a real payload,
 * so it would reset the mode on every mount.
 */
function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    return raw === 'edit' || raw === 'preview' ? raw : 'split';
  });
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }, [mode]);
  return [mode, setMode];
}

export function MarkdownTool({ initialPayload }: MarkdownToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('markdown.input', initialPayload ?? '');
  const [mode, setMode] = useViewMode();

  const showPreview = input.trim().length > 0;

  const preview = showPreview ? (
    <MarkdownPreview source={input} />
  ) : (
    <span className="text-muted">{t('tools.markdown.empty')}</span>
  );

  return (
    <ToolShell icon={TextQuote} title={t('tools.markdown.name')}>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Toolbar: view mode + source actions (available in every mode). */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-hover p-0.5">
            {VIEW_MODES.map(({ id, icon: Icon, labelKey }) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                title={t(labelKey)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ${
                  mode === id ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink'
                }`}
              >
                <Icon size={13} />
                {t(labelKey)}
              </button>
            ))}
          </div>
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

        {mode === 'edit' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <label className="mb-1.5 text-xs font-semibold text-muted">{t('tools.markdown.source')}</label>
            <textarea
              autoFocus
              className="min-h-[320px] w-full flex-1 resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="# 标题&#10;&#10;**加粗**、*斜体*、`代码`、[链接](https://loadix.dev)&#10;&#10;```mermaid&#10;flowchart LR&#10;  A --> B&#10;```"
            />
          </div>
        ) : mode === 'preview' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <label className="mb-1.5 text-xs font-semibold text-muted">{t('tools.markdown.preview')}</label>
            <div className="min-h-[320px] flex-1 overflow-auto rounded-lg border border-line bg-panel px-6 py-4">
              {preview}
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 max-lg:grid-cols-1">
            <div className="flex min-h-0 flex-col">
              <label className="mb-1.5 text-xs font-semibold text-muted">{t('tools.markdown.source')}</label>
              <textarea
                autoFocus
                className="min-h-[260px] w-full flex-1 resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="# 标题&#10;&#10;**加粗**、*斜体*、`代码`、[链接](https://loadix.dev)&#10;&#10;```mermaid&#10;flowchart LR&#10;  A --> B&#10;```"
              />
            </div>
            <div className="flex min-h-0 flex-col">
              <label className="mb-1.5 text-xs font-semibold text-muted">{t('tools.markdown.preview')}</label>
              <div className="min-h-[260px] flex-1 overflow-auto rounded-lg border border-line bg-panel px-4 py-3">
                {preview}
              </div>
            </div>
          </div>
        )}
      </div>
    </ToolShell>
  );
}