import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search } from 'lucide-react';
import { GROUPS, TOOLS, type Tool } from './registry';

interface ToolsMenuProps {
  activeTool: string | null;
  view: 'loadtest' | 'tools' | 'markdown';
  onSelect: (id: string) => void;
}

/**
 * Header tools menu: shows the most-used tools inline in the header (zero
 * clicks to discover them) and an "All tools" trigger that opens a grouped
 * popup listing every tool. Replaces the opaque "Tools" tab.
 */
export function ToolsMenu({ activeTool, view, onSelect }: ToolsMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('loadix-recent-tools') ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const ref = useRef<HTMLDivElement>(null);

  // Track recently used tools (persisted, max 4) for the inline row.
  useEffect(() => {
    if (!view || view === 'loadtest' || !activeTool) return;
    setRecent((list) => {
      const next = [activeTool, ...recent.filter((id) => id !== activeTool)].slice(0, 4);
      localStorage.setItem('loadix-recent-tools', JSON.stringify(next));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Markdown has its own top-level tab now, so it leaves the tools menu —
  // the tab is its single entry point.
  const GALLERY_TOOLS = TOOLS.filter((tool) => tool.id !== 'markdown');

  const q = query.trim().toLowerCase();
  const filtered = q
    ? GALLERY_TOOLS.filter(
        (tool) =>
          tool.id.includes(q) ||
          tool.keywords.some((k) => k.includes(q)) ||
          t(tool.nameKey).toLowerCase().includes(q),
      )
    : GALLERY_TOOLS;

  // Inline tools: recent first (deduped), then fill with defaults.
  const inline = [...new Set([...recent, ...GALLERY_TOOLS.slice(0, 4).map((tool) => tool.id)])].slice(0, 4);
  const inlineTools = inline
    .map((id) => GALLERY_TOOLS.find((tool) => tool.id === id))
    .filter((tool): tool is Tool => Boolean(tool));

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      {inlineTools.map((tool) => {
        const Icon = tool.icon;
        const active = view === 'tools' && tool.id === activeTool;
        return (
          <button
            key={tool.id}
            onClick={() => onSelect(tool.id)}
            title={t(tool.descKey)}
            className={`relative flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 ${
              active ? 'font-bold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {active && (
              <motion.span layoutId="view-active" className="absolute inset-0 rounded-lg bg-primary/10" />
            )}
            <Icon size={15} className="relative shrink-0" />
            <span className="relative hidden xl:inline">{t(tool.nameKey)}</span>
          </button>
        );
      })}

      {/* More: popup with every tool, searchable */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 ${
          open ? 'text-primary' : 'text-muted hover:bg-hover hover:text-ink'
        }`}
      >
        {t('tools.more')}
        <ChevronDown size={14} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="absolute right-0 top-full z-50 mt-2 w-[560px] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
          >
            {/* Search */}
            <div className="border-b border-line px-4 py-2.5">
              <input
                autoFocus
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
                placeholder={t('tools.palettePlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {/* Mega-menu body: grouped columns, e-commerce style.
                No max-height / no scrolling — all tools visible at once. */}
            <div className="p-4">
              {GROUPS.map((group) => {
                const tools = filtered.filter((tool) => tool.group === group.id);
                if (!tools.length) return null;
                return (
                  <div key={group.id} className="mb-4 last:mb-1">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted/70">
                      {t(group.labelKey)}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 max-sm:grid-cols-2">
                      {tools.map((tool) => {
                        const Icon = tool.icon;
                        const active = tool.id === activeTool;
                        return (
                          <button
                            key={tool.id}
                            onClick={() => {
                              onSelect(tool.id);
                              setOpen(false);
                            }}
                            className={`group flex items-start gap-2.5 rounded-lg border border-transparent p-2.5 text-left transition-all duration-150 hover:border-line hover:bg-hover ${
                              tool.id === activeTool ? 'bg-primary/5' : ''
                            }`}
                          >
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-150 group-hover:bg-primary group-hover:text-white">
                              <Icon size={16} />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-semibold">{t(tool.nameKey)}</span>
                              <span className="block truncate text-[11px] leading-snug text-muted">{t(tool.descKey)}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && <p className="px-4 py-8 text-center text-xs text-muted">{t('tools.noResults')}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
