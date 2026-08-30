import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { TOOLS } from './registry';
import { SmartPaste } from './SmartPaste';

interface ToolsWorkspaceProps {
  activeTool: string;
  onSelect: (id: string, payload?: string) => void;
  children: ReactNode;
}

/**
 * Master–detail tools workspace: a flat, always-visible tool list on the left
 * (one click to switch, no back button) and the active tool on the right.
 * A smart-paste box on top sniffs pasted content and routes it to the right
 * tool automatically.
 */
export function ToolsWorkspace({ activeTool, onSelect, children }: ToolsWorkspaceProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<{ id: string; payload?: string } | null>(null);

  const visible = TOOLS.filter((tool) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      tool.id.includes(q) ||
      tool.keywords.some((k) => k.includes(q)) ||
      t(tool.nameKey).toLowerCase().includes(q)
    );
  });

  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-6 max-lg:grid-cols-1">
      {/* ——— Master: tool list ——— */}
      <aside className="min-w-0">
        <SmartPaste onOpen={onSelect} />

        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="w-full rounded-lg border border-line bg-panel py-2 pl-8 pr-2.5 text-sm outline-none transition-colors duration-150 focus:border-primary"
            placeholder={t('tools.filter')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <nav className="mt-2 flex flex-col gap-0.5">
          {visible.map((tool) => {
            const Icon = tool.icon;
            const active = tool.id === activeTool;
            return (
              <button
                key={tool.id}
                onClick={() => onSelect(tool.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 ${
                  active ? 'bg-primary/10 font-bold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
                }`}
              >
                <Icon size={16} className="shrink-0" />
                <span className="truncate">{t(tool.nameKey)}</span>
              </button>
            );
          })}
          {visible.length === 0 && <p className="px-3 py-2 text-xs text-muted">{t('tools.noResults')}</p>}
        </nav>
      </aside>

      {/* ——— Detail: active tool ——— */}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
