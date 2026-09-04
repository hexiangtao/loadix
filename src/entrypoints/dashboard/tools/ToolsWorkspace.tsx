import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
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
const SIDEBAR_KEY = 'loadix-tools.sidebarCollapsed';

export function ToolsWorkspace({ activeTool, onSelect, children }: ToolsWorkspaceProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [direction, setDirection] = useState(1);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1');

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Collapsing hides the filter box, so clear the query to keep the icon strip complete.
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (next) setFilter('');
  };

  const visible = TOOLS.filter((tool) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      tool.id.includes(q) ||
      tool.keywords.some((k) => k.includes(q)) ||
      t(tool.nameKey).toLowerCase().includes(q)
    );
  });

  // Slide direction follows list order so switching feels spatial, not random.
  const handleSelect = (id: string) => {
    const from = TOOLS.findIndex((tool) => tool.id === activeTool);
    const to = TOOLS.findIndex((tool) => tool.id === id);
    setDirection(to > from ? 1 : -1);
    onSelect(id);
  };

  return (
    <div
      className={`grid gap-6 transition-[grid-template-columns] duration-200 ease-out ${
        collapsed ? 'grid-cols-[52px_minmax(0,1fr)]' : 'grid-cols-[220px_minmax(0,1fr)] max-lg:grid-cols-1'
      }`}
    >
      {/* ——— Master: tool list ——— */}
      <aside className="min-w-0">
        <div className={`mb-2 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && <span className="pl-3 text-xs font-bold text-muted">{t('tools.title')}</span>}
          <button
            onClick={toggleSidebar}
            title={collapsed ? t('tools.expandSidebar') : t('tools.collapseSidebar')}
            className="rounded-lg p-1.5 text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        {!collapsed && (
          <>
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
          </>
        )}

        <nav className={`relative mt-2 flex flex-col gap-0.5 ${collapsed ? 'items-center' : ''}`}>
          {visible.map((tool) => {
            const Icon = tool.icon;
            const active = tool.id === activeTool;
            return (
              <button
                key={tool.id}
                onClick={() => handleSelect(tool.id)}
                title={collapsed ? t(tool.nameKey) : undefined}
                className={`relative flex w-full items-center gap-2.5 rounded-lg text-left text-sm transition-colors duration-150 ${
                  collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
                } ${active ? 'font-bold text-primary' : 'text-muted hover:bg-hover hover:text-ink'}`}
              >
                {active && (
                  <motion.span
                    layoutId="tool-active"
                    className="absolute inset-0 rounded-lg bg-primary/10"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon size={16} className="relative shrink-0" />
                {!collapsed && <span className="relative truncate">{t(tool.nameKey)}</span>}
              </button>
            );
          })}
          {visible.length === 0 && !collapsed && <p className="px-3 py-2 text-xs text-muted">{t('tools.noResults')}</p>}
        </nav>
      </aside>

      {/* ——— Detail: active tool ——— */}
      <div className="min-w-0" data-screenshot-target="panel">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTool}
            initial={{ opacity: 0, y: 10 * direction }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 * direction }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
