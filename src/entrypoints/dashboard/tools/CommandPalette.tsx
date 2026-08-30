import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GROUPS, TOOLS, type Tool } from './registry';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}

/** Ctrl/Cmd+K fuzzy tool picker. */
export function CommandPalette({ open, onClose, onSelect }: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TOOLS;
    return TOOLS.filter(
      (tool) =>
        tool.id.includes(q) ||
        tool.keywords.some((k) => k.includes(q)) ||
        t(tool.nameKey).toLowerCase().includes(q) ||
        t(tool.descKey).toLowerCase().includes(q),
    );
  }, [query, t]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // Focus after mount so the palette can receive keystrokes.
      const id = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  if (!open) return null;

  const pick = (tool: Tool) => {
    onSelect(tool.id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const tool = results[activeIdx];
      if (tool) pick(tool);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(560px,90vw)] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
        <input
          ref={inputRef}
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[15px] outline-none placeholder:text-muted"
          placeholder={t('tools.palettePlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div ref={listRef} className="max-h-[40vh] overflow-auto py-2">
          {results.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">{t('tools.noResults')}</p>}
          {results.map((tool, i) => {
            const group = GROUPS.find((g) => g.id === tool.group);
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => pick(tool)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100 ${
                  i === activeIdx ? 'bg-hover' : ''
                }`}
              >
                <Icon size={18} className="shrink-0 text-primary" />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{t(tool.nameKey)}</span>
                  <span className="block text-xs text-muted">{t(tool.descKey)}</span>
                </span>
                {group && <span className="text-[11px] text-muted">{t(group.labelKey)}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
