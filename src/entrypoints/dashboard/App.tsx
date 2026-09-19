import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { EngineHost } from '@/engine/engine-host';
import type { ApiRequest } from './api/apiTypes';
import { changeLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from './i18n';
import { useUiStore } from './store/ui-store';
import { RequestDetails } from './components/RequestDetails';
import { storageGet, storageSet } from './storage';
import { CommandPalette } from './tools/CommandPalette';
import { ToolsWorkspace } from './tools/ToolsWorkspace';
import { ToolsMenu } from './tools/ToolsMenu';
import { LazyToolView } from './tools/LazyToolView';
import { findTool } from './tools/registry';
import { useAutoHideHeader } from './useAutoHideHeader';
import { ApiModule, isDashboardModule, MarkdownModule, MediaModule } from './module-registry';
import { LoadTestModule } from './loadtest/LoadTestModule';

const THEME_KEY = 'api-pressure-theme';
type View = 'loadtest' | 'tools' | 'markdown' | 'api' | 'media';
const LANGUAGE_LABELS: Record<SupportedLanguage, string> = { en: 'English', 'zh-CN': '简体中文', ja: '日本語', ko: '한국어', fr: 'Français' };

function toolFromUrl(): string | null {
  try {
    const id = new URLSearchParams(window.location.search).get('tool');
    return id && (findTool(id) || isDashboardModule(id)) ? id : null;
  } catch {
    return null;
  }
}

export default function App({ host }: { host: EngineHost }) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme, selectedRequest, setSelectedRequest } = useUiStore();
  const [view, setView] = useState<View>(() => {
    const tool = toolFromUrl();
    if (tool === 'markdown' || tool === 'api' || tool === 'media') return tool;
    if (tool) return 'tools';
    const saved = localStorage.getItem('loadix-view');
    return saved === 'tools' || saved === 'markdown' || saved === 'api' || saved === 'media' ? saved : 'loadtest';
  });
  const [activeTool, setActiveTool] = useState<string | null>(() => toolFromUrl() ?? 'base64');
  const [toolPayload, setToolPayload] = useState<string | undefined>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [initialRequest, setInitialRequest] = useState<ApiRequest | undefined>();
  const [mediaActivated, setMediaActivated] = useState(() => view === 'media');
  const [markdownFullscreen, setMarkdownFullscreen] = useState(false);
  const headerHidden = useAutoHideHeader(view === 'markdown' && !markdownFullscreen);
  const markdownChromeGone = view === 'markdown' && (markdownFullscreen || headerHidden);
  const extensionMode = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

  useEffect(() => {
    localStorage.setItem('loadix-view', view);
    if (view === 'media') setMediaActivated(true);
    if (view !== 'markdown') setMarkdownFullscreen(false);
  }, [view]);
  useEffect(() => {
    void storageGet<'light' | 'dark'>(THEME_KEY).then((saved) => setTheme(saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')));
  }, [setTheme]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    void storageSet(THEME_KEY, theme);
  }, [theme]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((open) => !open); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openTool = (id: string, payload?: string) => {
    setActiveTool(id === 'markdown' || id === 'api' || id === 'media' ? null : id);
    setToolPayload(payload);
    setView(id === 'markdown' ? 'markdown' : id === 'api' ? 'api' : id === 'media' ? 'media' : 'tools');
  };
  const switchView = (next: View) => { setView(next); if (next !== 'tools') setActiveTool(null); };
  const openInMarkdown = useCallback((markdown: string) => { setActiveTool(null); setToolPayload(markdown); setView('markdown'); }, []);
  const openInLoadTest = useCallback((request: ApiRequest) => { setInitialRequest(request); setView('loadtest'); }, []);
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return (
    <>
      <header className={`toolbar flex h-14 items-center px-6 transition-transform duration-300 ${markdownChromeGone ? '-translate-y-full' : 'translate-y-0'}`}>
        <a href="https://loadix.dev" target="_blank" rel="noreferrer" title={t('app.name')} className="rounded-lg text-[15px] font-bold hover:text-primary">{t('app.name')}</a>
        <div className="flex-1" />
        <nav className="mr-2 flex shrink-0 items-center gap-1">
          {(['markdown', 'api', 'media', 'loadtest'] as const).map((id) => <button key={id} onClick={() => switchView(id)} className={`relative whitespace-nowrap rounded-lg px-3 py-2 text-sm ${view === id ? 'font-bold text-primary' : 'text-muted hover:bg-hover hover:text-ink'}`}>
            {view === id && <motion.span layoutId="view-active" className="absolute inset-0 rounded-lg bg-primary/10" />}
            <span className="relative">{id === 'markdown' ? t('tools.markdown.name') : id === 'api' ? t('tools.requests.name') : id === 'media' ? t('media.nav') : t('views.loadtest')}</span>
          </button>)}
          <span className="mx-1 h-6 w-px bg-line" />
          <ToolsMenu activeTool={activeTool} view={view} onSelect={openTool} />
          <button onClick={() => setPaletteOpen(true)} title={t('tools.searchTools')} aria-label={t('tools.searchTools')} className="ml-1 flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[13px] text-muted hover:border-primary/40 hover:text-ink"><Search size={13} /><span className="max-w-28 truncate">{t('tools.searchTools')}</span><kbd className="rounded border border-line bg-surface px-1 text-[10px]">Ctrl K</kbd></button>
        </nav>
        <div className="flex items-center gap-1">
          <button className="nav-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Light' : 'Dark'} aria-label="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
          <select value={i18n.language} onChange={(event) => void changeLanguage(event.target.value as SupportedLanguage)} className="cursor-pointer rounded-lg px-2 py-1.5 text-sm text-muted outline-none hover:bg-hover hover:text-ink">{SUPPORTED_LANGUAGES.map((lang) => <option key={lang} value={lang}>{LANGUAGE_LABELS[lang]}</option>)}</select>
        </div>
      </header>

      {view === 'loadtest' && <LoadTestModule host={host} initialRequest={initialRequest} onInitialRequestConsumed={() => setInitialRequest(undefined)} />}
      {view === 'markdown' && <MarkdownModule initialPayload={toolPayload} fullscreen={markdownFullscreen} chromeGone={markdownChromeGone} onToggleFullscreen={() => setMarkdownFullscreen((value) => !value)} />}
      {view === 'api' && <ApiModule onOpenInLoadTest={openInLoadTest} onOpenInMarkdown={openInMarkdown} />}
      {view === 'tools' && <main className="mx-auto w-full px-7 py-7"><ToolsWorkspace activeTool={activeTool ?? 'base64'} onSelect={openTool}><LazyToolView id={activeTool ?? 'base64'} payload={toolPayload} /></ToolsWorkspace></main>}
      {mediaActivated && <div className={view === 'media' ? 'contents' : 'hidden'} aria-hidden={view !== 'media'}><MediaModule extensionMode={extensionMode} /></div>}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSelect={openTool} />
      <RequestDetails request={selectedRequest} requestUrl={selectedRequest?.finalUrl ?? ''} onClose={() => setSelectedRequest(null)} />
    </>
  );
}
