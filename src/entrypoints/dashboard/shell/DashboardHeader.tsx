import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { changeLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n';
import { preloadDashboardModule } from '../module-registry';
import { ToolsMenu } from '../tools/ToolsMenu';

type View = 'loadtest' | 'tools' | 'markdown' | 'api' | 'media';

interface DashboardHeaderProps {
  view: View;
  activeTool: string | null;
  theme: 'light' | 'dark';
  chromeGone: boolean;
  onView: (view: View) => void;
  onTool: (id: string, payload?: string) => void;
  onOpenPalette: () => void;
  onToggleTheme: () => void;
}

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English', 'zh-CN': '简体中文', ja: '日本語', ko: '한국어', fr: 'Français',
};

export function DashboardHeader({ view, activeTool, theme, chromeGone, onView, onTool, onOpenPalette, onToggleTheme }: DashboardHeaderProps) {
  const { t, i18n } = useTranslation();
  const destinations: View[] = ['markdown', 'api', 'media', 'loadtest'];

  return (
    <header className={`toolbar flex h-14 items-center px-6 transition-transform duration-300 ${chromeGone ? '-translate-y-full' : 'translate-y-0'}`}>
      <a href="https://loadix.dev" target="_blank" rel="noreferrer" title={t('app.name')} className="rounded-lg text-[15px] font-bold hover:text-primary">{t('app.name')}</a>
      <div className="flex-1" />
      <nav className="mr-2 flex shrink-0 items-center gap-1">
        {destinations.map((id) => <button key={id} onClick={() => onView(id)}
          onMouseEnter={() => (id === 'markdown' || id === 'api' || id === 'media') && preloadDashboardModule(id)}
          onFocus={() => (id === 'markdown' || id === 'api' || id === 'media') && preloadDashboardModule(id)}
          className={`relative whitespace-nowrap rounded-lg px-3 py-2 text-sm ${view === id ? 'font-bold text-primary' : 'text-muted hover:bg-hover hover:text-ink'}`}>
          {view === id && <motion.span layoutId="view-active" className="absolute inset-0 rounded-lg bg-primary/10" />}
          <span className="relative">{id === 'markdown' ? t('tools.markdown.name') : id === 'api' ? t('tools.requests.name') : id === 'media' ? t('media.nav') : t('views.loadtest')}</span>
        </button>)}
        <span className="mx-1 h-6 w-px bg-line" />
        <ToolsMenu activeTool={activeTool} view={view} onSelect={onTool} />
        <button onClick={onOpenPalette} title={t('tools.searchTools')} aria-label={t('tools.searchTools')} className="ml-1 flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[13px] text-muted hover:border-primary/40 hover:text-ink"><Search size={13} /><span className="max-w-28 truncate">{t('tools.searchTools')}</span><kbd className="rounded border border-line bg-surface px-1 text-[10px]">Ctrl K</kbd></button>
      </nav>
      <div className="flex items-center gap-1">
        <button className="nav-btn" onClick={onToggleTheme} title={theme === 'dark' ? 'Light' : 'Dark'} aria-label="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
        <select value={i18n.language} onChange={(event) => void changeLanguage(event.target.value as SupportedLanguage)} className="cursor-pointer rounded-lg px-2 py-1.5 text-sm text-muted outline-none hover:bg-hover hover:text-ink">
          {SUPPORTED_LANGUAGES.map((lang) => <option key={lang} value={lang}>{LANGUAGE_LABELS[lang]}</option>)}
        </select>
      </div>
    </header>
  );
}
