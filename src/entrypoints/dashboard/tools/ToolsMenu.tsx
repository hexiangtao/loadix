import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { GROUPS, TOOLS } from './registry';

/** Max popup width. Wide enough for a 4-column tool grid so the menu stays
    short and rarely needs to scroll. */
const MENU_MAX_W = 760;

interface ToolsMenuProps {
  activeTool: string | null;
  view: 'loadtest' | 'tools' | 'markdown';
  onSelect: (id: string) => void;
}

/**
 * Header "更多" menu — the single entry point for every utility tool.
 * Markdown and the load-test workbench own the top-level tabs, so the header
 * stays focused on three destinations. The popup is grouped and searchable;
 * once inside a tool, ToolsWorkspace's own sidebar takes over switching (and
 * Ctrl/Cmd+K opens the same gallery from anywhere).
 */
export function ToolsMenu({ activeTool, view, onSelect }: ToolsMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // A tool is open → the trigger reads as the active destination.
  const inTools = view === 'tools';

  // Markdown lives on its own top-level tab — it stays out of the menu.
  const gallery = TOOLS.filter((tool) => tool.id !== 'markdown');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // Close on outside click / Escape.
  // Anchor the popup under the trigger. Prefer the full width (up to
  // MENU_MAX_W); if the space to the right of the trigger is too small,
  // grow leftward instead so the menu never clips and stays short enough
  // to avoid an internal scrollbar.
  const placeMenu = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(MENU_MAX_W, window.innerWidth - 16);
    let left = r.left;
    if (left + width + 8 > window.innerWidth) left = Math.max(8, window.innerWidth - width - 8);
    setPos({ left, top: r.bottom + 8, width });
  }, []);

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
    window.addEventListener('resize', placeMenu);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', placeMenu);
    };
  }, [open, placeMenu]);

  // 4 columns when wide enough to stay short; fall back to 3 / 2 on narrow
  // windows where tiles would get cramped.
  const gridCols = !pos ? 4 : pos.width >= 660 ? 4 : pos.width >= 500 ? 3 : 2;
  const gridClass = gridCols === 4 ? 'grid-cols-4' : gridCols === 3 ? 'grid-cols-3' : 'grid-cols-2';

  const q = query.trim().toLowerCase();
  const filtered = q
    ? gallery.filter(
        (tool) =>
          tool.id.includes(q) ||
          tool.keywords.some((k) => k.includes(q)) ||
          t(tool.nameKey).toLowerCase().includes(q),
      )
    : gallery;

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        onClick={() => {
          if (!open) placeMenu();
          setOpen((v) => !v);
        }}
        className={`relative flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 ${
          open || inTools ? 'font-bold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
        }`}
      >
        {t('tools.more')}
        <ChevronDown size={14} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            style={pos ? { left: pos.left, top: pos.top, width: pos.width } : undefined}
            className="app-scroller fixed z-50 max-h-[calc(100vh-5rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-line bg-panel shadow-2xl"
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

            {/* Mega-menu body: grouped columns. No max-height / no scrolling —
                every tool visible at once. */}
            <div className="p-4">
              {GROUPS.map((group) => {
                const tools = filtered.filter((tool) => tool.group === group.id);
                if (!tools.length) return null;
                return (
                  <div key={group.id} className="mb-4 last:mb-1">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted/70">
                      {t(group.labelKey)}
                    </div>
                    <div className={`grid gap-1.5 ${gridClass}`}>
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
                              active ? 'bg-primary/5' : ''
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
