import { useCallback, useEffect, useState } from 'react';
import type { EngineHost } from '@/engine/engine-host';
import type { ModuleIntent } from '../module-protocol';
import { storageGet, storageSet } from '../storage';
import { useThemeStore } from '../store/theme-store';
import { useRequestDetailsStore } from '../store/request-details-store';
import { RequestDetails } from '../components/RequestDetails';
import { CommandPalette } from '../tools/CommandPalette';
import { ToolsWorkspace } from '../tools/ToolsWorkspace';
import { LazyToolView } from '../tools/LazyToolView';
import { findTool } from '../tools/registry';
import { useAutoHideHeader } from '../useAutoHideHeader';
import { ApiModule, isDashboardModule, MarkdownModule, MediaModule } from '../module-registry';
import { LoadTestModule } from '../loadtest/LoadTestModule';
import { DashboardHeader } from './DashboardHeader';

const THEME_KEY = 'api-pressure-theme';
export type DashboardView = 'loadtest' | 'tools' | 'markdown' | 'api' | 'media';

function initialTool(): string | null {
  try { return new URLSearchParams(window.location.search).get('tool'); } catch { return null; }
}
function isKnownDestination(id: string | null): id is DashboardView {
  return !!id && (id === 'markdown' || id === 'api' || id === 'media' || id === 'loadtest' || !!findTool(id) || isDashboardModule(id));
}
function viewFromStorage(): DashboardView {
  const tool = initialTool();
  if (tool === 'markdown' || tool === 'api' || tool === 'media') return tool;
  if (tool && isKnownDestination(tool)) return 'tools';
  const saved = localStorage.getItem('loadix-view');
  return saved === 'tools' || saved === 'markdown' || saved === 'api' || saved === 'media' ? saved : 'loadtest';
}

export function DashboardShell({ host }: { host: EngineHost }) {
  const { theme, setTheme } = useThemeStore();
  const { selectedRequest, setSelectedRequest } = useRequestDetailsStore();
  const [view, setView] = useState<DashboardView>(viewFromStorage);
  const [activeTool, setActiveTool] = useState<string | null>(() => initialTool() ?? 'base64');
  const [toolPayload, setToolPayload] = useState<string | undefined>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [initialRequest, setInitialRequest] = useState<Extract<ModuleIntent, { type: 'open-loadtest' }>['request'] | undefined>();
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
  const switchView = (next: DashboardView) => { setView(next); if (next !== 'tools') setActiveTool(null); };
  const handleIntent = useCallback((intent: ModuleIntent) => {
    if (intent.type === 'open-loadtest') {
      setInitialRequest(intent.request);
      setView('loadtest');
    } else if (intent.type === 'open-markdown') {
      setActiveTool(null);
      setToolPayload(intent.markdown);
      setView('markdown');
    }
  }, []);
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return (
    <>
      <DashboardHeader view={view} activeTool={activeTool} theme={theme} chromeGone={markdownChromeGone} onView={switchView} onTool={openTool} onOpenPalette={() => setPaletteOpen(true)} onToggleTheme={toggleTheme} />
      {view === 'loadtest' && <LoadTestModule host={host} initialRequest={initialRequest} onInitialRequestConsumed={() => setInitialRequest(undefined)} />}
      {view === 'markdown' && <MarkdownModule initialPayload={toolPayload} fullscreen={markdownFullscreen} chromeGone={markdownChromeGone} onToggleFullscreen={() => setMarkdownFullscreen((value) => !value)} />}
      {view === 'api' && <ApiModule onIntent={handleIntent} />}
      {view === 'tools' && <main className="mx-auto w-full px-7 py-7"><ToolsWorkspace activeTool={activeTool ?? 'base64'} onSelect={openTool}><LazyToolView id={activeTool ?? 'base64'} payload={toolPayload} /></ToolsWorkspace></main>}
      {mediaActivated && <div className={view === 'media' ? 'contents' : 'hidden'} aria-hidden={view !== 'media'}><MediaModule extensionMode={extensionMode} /></div>}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSelect={openTool} />
      <RequestDetails request={selectedRequest} requestUrl={selectedRequest?.finalUrl ?? ''} onClose={() => setSelectedRequest(null)} />
    </>
  );
}
