import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { toPng } from 'html-to-image';
import {
  Check,
  Columns2,
  Copy,
  ExternalLink,
  Eye,
  ImageDown,
  Loader2,
  PencilLine,
  Share2,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import { CopyButton } from '../tools/CopyButton';
import { useAutoHideHeader } from '../useAutoHideHeader';
import { MarkdownPreview } from './MarkdownPreview';
import { MarkdownEditor } from './MarkdownEditor';
import { flattenForExport, svgToPng } from './MermaidBlock';
import { DocSidebar } from './DocSidebar';
import {
  createDoc,
  createFolder,
  deleteDoc,
  deleteFolder,
  docDisplayTitle,
  getAllDocs,
  getDoc,
  loadWorkspace,
  patchDocMeta,
  renameFolder,
  saveDoc,
  type MarkdownDoc,
  type MarkdownFolder,
} from './docStore';
import sample from './markdown-sample.md?raw';

interface MarkdownToolProps {
  initialPayload?: string;
  /** Fullscreen reading (preview mode): hides all chrome and widens the
      document to the viewport. Toggled by double-click or Ctrl/Cmd+Shift+F. */
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
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
const ACTIVE_DOC_KEY = 'loadix-tool:markdown.activeDoc';
const EXPORT_SCALES = [1, 2, 3];

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

export function MarkdownTool({ initialPayload, fullscreen = false, onToggleFullscreen }: MarkdownToolProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useViewMode();
  // Reading mode is immersive: scrolling the rendered document collapses the
  // action toolbar (and the app header, driven from App.tsx) so the page
  // becomes pure content. While editing the toolbar stays put. Fullscreen
  // reading forces the toolbar away regardless of scroll.
  const chromeHidden = useAutoHideHeader(mode === 'preview' && !fullscreen);

  /* ——— Document workspace state ——— */
  const [ready, setReady] = useState(false);
  const [docs, setDocs] = useState<MarkdownDoc[]>([]);
  const [folders, setFolders] = useState<MarkdownFolder[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  // The doc id whose content `input` currently holds — autosave only fires
  // while they match, so switching docs can't cross-write contents.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const docsRef = useRef<MarkdownDoc[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const inputRef = useRef('');
  const payloadConsumed = useRef(false);

  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);
  useEffect(() => {
    activeIdRef.current = activeDocId;
  }, [activeDocId]);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  /** Persists the current working copy to IndexedDB (uses refs, so it's safe
      to call from timers and unmount cleanup). */
  const persist = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    const existing = docsRef.current.find((d) => d.id === id);
    if (!existing) return;
    const updated: MarkdownDoc = { ...existing, content: inputRef.current, updatedAt: Date.now() };
    await saveDoc(updated);
    setDocs((list) => list.map((d) => (d.id === id ? updated : d)));
  }, []);

  /** Flushes any pending edit, then loads the target document. */
  const openDoc = useCallback(
    (id: string) => {
      void persist(); // activeIdRef still points at the outgoing doc
      setActiveDocId(id);
      activeIdRef.current = id;
      localStorage.setItem(ACTIVE_DOC_KEY, id);
      void getDoc(id).then((doc) => {
        if (doc && activeIdRef.current === id) {
          setInput(doc.content);
          setLoadedFor(id);
        }
      });
    },
    [persist],
  );

  /** Editor/sample input lands here so the loaded-doc guard stays correct. */
  const updateInput = useCallback((value: string) => {
    setInput(value);
    setLoadedFor(activeIdRef.current);
  }, []);

  // Debounced autosave: 500ms after the last keystroke, and only for the doc
  // whose content is actually in the editor.
  useEffect(() => {
    if (!ready || !activeDocId || loadedFor !== activeDocId) return;
    const timer = window.setTimeout(() => void persist(), 500);
    return () => window.clearTimeout(timer);
  }, [input, activeDocId, loadedFor, ready, persist]);

  // Leave nothing behind on unmount.
  useEffect(() => () => void persist(), [persist]);

  // First run: migrate the legacy doc, list the workspace, pick the active
  // document (deep-link payload > last opened > most recent > a fresh one).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { docs: all, folders: allFolders } = await loadWorkspace();
      if (cancelled) return;
      setDocs(all);
      setFolders(allFolders);
      setReady(true);

      let targetId: string | null = null;
      if (payloadConsumed.current) return;
      if (initialPayload != null) {
        // A routed payload (palette / smart paste) becomes a new document.
        payloadConsumed.current = true;
        const created = await createDoc({ content: initialPayload });
        if (cancelled) return;
        setDocs((list) => [created, ...list]);
        targetId = created.id;
      } else {
        payloadConsumed.current = true;
        const saved = localStorage.getItem(ACTIVE_DOC_KEY);
        targetId = saved && all.some((d) => d.id === saved) ? saved : (all[0]?.id ?? null);
      }
      if (!targetId) {
        const created = await createDoc({});
        if (cancelled) return;
        setDocs([created]);
        targetId = created.id;
      }
      openDoc(targetId);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ——— Document CRUD ——— */

  const handleCreateDoc = useCallback(
    async (folderId: string | null) => {
      const doc = await createDoc({ folderId });
      setDocs((list) => [doc, ...list]);
      openDoc(doc.id);
    },
    [openDoc],
  );

  const handleRenameDoc = useCallback(async (id: string, title: string) => {
    const updated = await patchDocMeta(id, { title });
    if (updated) setDocs((list) => list.map((d) => (d.id === id ? updated : d)));
  }, []);

  const handleMoveDoc = useCallback(async (id: string, folderId: string | null) => {
    const updated = await patchDocMeta(id, { folderId });
    if (updated) setDocs((list) => list.map((d) => (d.id === id ? updated : d)));
  }, []);

  const handleDeleteDoc = useCallback(
    async (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id);
      if (!doc) return;
      const title = docDisplayTitle(doc, t('tools.markdown.untitled'));
      if (!window.confirm(t('tools.markdown.confirmDeleteDoc', { title }))) return;
      await deleteDoc(id);
      const remaining = docsRef.current.filter((d) => d.id !== id);
      // Sync the ref now: the openDoc() flush below must not resurrect the
      // just-deleted doc (it would re-save its content under its old id).
      docsRef.current = remaining;
      setDocs(remaining);
      if (activeIdRef.current === id) {
        const next = remaining[0] ?? null;
        if (next) {
          openDoc(next.id);
        } else {
          const created = await createDoc({});
          setDocs([created]);
          openDoc(created.id);
        }
      }
    },
    [openDoc, t],
  );

  const handleCreateFolder = useCallback(async (name: string) => {
    const folder = await createFolder(name);
    setFolders((list) => [...list, folder]);
  }, []);

  const handleRenameFolder = useCallback(async (id: string, name: string) => {
    const updated = await renameFolder(id, name);
    if (updated) setFolders((list) => list.map((f) => (f.id === id ? updated : f)));
  }, []);

  const handleDeleteFolder = useCallback(async (id: string) => {
    if (!window.confirm(t('tools.markdown.confirmDeleteFolder'))) return;
    await deleteFolder(id);
    setFolders((list) => list.filter((f) => f.id !== id));
    setDocs(await getAllDocs()); // folder deletion moves docs back to root
  }, [t]);


  // Fullscreen toggles: double-click on the document, Ctrl/Cmd+Shift+F (only
  // meaningful while previewing), Esc to leave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'preview') return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        onToggleFullscreen?.();
      } else if (e.key === 'Escape' && fullscreen) {
        onToggleFullscreen?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, fullscreen, onToggleFullscreen]);

  // Entering fullscreen starts the read from the top of the document.
  useEffect(() => {
    if (fullscreen) window.scrollTo(0, 0);
  }, [fullscreen]);
  const [scale, setScale] = useState(2);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareDialog, setShareDialog] = useState<ShareDialogState | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const failTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(failTimerRef.current), []);

  const showPreview = input.trim().length > 0;

  // The share API is hosted on the web build (lab.loadix.dev); the extension
  // dashboard has no backend, so the button only appears in http(s) contexts.
  const canShare = /^https?:$/.test(window.location.protocol);

  const preview = showPreview ? (
    <MarkdownPreview source={input} />
  ) : (
    <span className="text-muted">{t('tools.markdown.empty')}</span>
  );

  /**
   * Renders the document off-screen at the tool's full width (works from any
   * view mode, so edit mode exports too), flattens mermaid labels into real
   * SVG text (the capture path drops foreignObject content), then rasterizes
   * the whole node to PNG at the chosen scale.
   */
  const exportFull = async () => {
    if (exporting || !showPreview) return;
    setExporting(true);
    setExportFailed(false);

    let wrapper: HTMLDivElement | null = null;
    let host: HTMLDivElement | null = null;
    let root: Root | null = null;
    try {
      const width = Math.max(320, Math.round(areaRef.current?.clientWidth ?? 800));
      const bg =
        getComputedStyle(document.documentElement).getPropertyValue('--color-panel').trim() ||
        '#ffffff';

      // Off-screen positioning lives on the wrapper; the host itself stays
      // static so html-to-image's style-inlining pass doesn't inherit it.
      wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed; left:-10000px; top:0; z-index:-1;';
      host = document.createElement('div');
      host.style.cssText = `width:${width}px; background:${bg};`;
      wrapper.appendChild(host);
      document.body.appendChild(wrapper);

      root = createRoot(host);
      root.render(<MarkdownPreview source={input} />);

      await waitForDiagrams(host);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 200)); // let fonts/layout settle

      // Mermaid labels are foreignObjects and the capture renderer drops them,
      // so each diagram is pre-rasterized through the same pixel-exact
      // standalone pipeline as the per-diagram export button, then swapped for
      // a plain <img>. Raster images survive the capture reliably; raw SVG
      // text does not.
      for (const svg of Array.from(host.querySelectorAll<SVGSVGElement>('.md-mermaid svg'))) {
        try {
          const rect = svg.getBoundingClientRect();
          const flat = flattenForExport(svg);
          const png = await svgToPng(flat, scale);
          const img = document.createElement('img');
          img.src = await blobToDataUrl(png);
          img.style.cssText = `width:${Math.round(rect.width)}px; height:${Math.round(rect.height)}px; display:block; max-width:none;`;
          svg.replaceWith(img);
        } catch {
          // Keep the original SVG — worst case the diagram loses labels.
        }
      }
      // Wide tables / diagrams scroll in the live view; export must not clip.
      host.querySelectorAll<HTMLElement>('.md-mermaid, .md-table-wrap, pre').forEach((el) => {
        el.style.overflow = 'visible';
      });

      let dataUrl: string | null = null;
      for (let ratio = scale; ratio >= 1; ratio--) {
        try {
          dataUrl = await toPng(host, {
            pixelRatio: ratio,
            skipFonts: true, // MathML + system fonts cover the rendered content
            backgroundColor: bg,
          });
          break;
        } catch {
          if (ratio <= 1) throw new Error('Rasterization failed');
        }
      }

      const blob = await (await fetch(dataUrl!)).blob();
      downloadBlob(blob, `loadix-markdown-${stamp()}.png`);
    } catch (e) {
      console.error('[markdown] full export failed:', e);
      setExportFailed(true);
      window.clearTimeout(failTimerRef.current);
      failTimerRef.current = window.setTimeout(() => setExportFailed(false), 2600);
    } finally {
      root?.unmount();
      wrapper?.remove();
      setExporting(false);
    }
  };

  /**
   * POSTs the current source to the share API and opens the result dialog
   * with the link. Failures map to a friendly, retryable message.
   */
  const shareDoc = async () => {
    if (sharing || !showPreview) return;
    setSharing(true);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: input }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok) {
        setShareDialog({
          status: 'error',
          reason: data?.error === 'source_too_large' ? 'too-large' : 'generic',
        });
        return;
      }
      if (!data?.id) throw new Error('Share response missing id');
      // The id rides in both the path and the query: hosts that redirect /s/*
      // to a clean path keep the query (but drop the path id), so the viewer
      // can recover the document either way.
      const url = `${window.location.origin}/s/${data.id}?id=${data.id}`;
      // Copy immediately — still inside the click's user-activation window, so
      // no extra permission prompt is needed on first use. If the clipboard is
      // denied the dialog falls back to the pre-selected URL + manual button.
      const autoCopied = await copyToClipboard(url);
      setShareDialog({ status: 'ready', url, autoCopied });
    } catch (e) {
      console.error('[markdown] share failed:', e);
      setShareDialog({ status: 'error', reason: 'generic' });
    } finally {
      setSharing(false);
    }
  };

  return (
    <div
      className={`flex gap-3 transition-all duration-300 ${
        fullscreen ? 'min-h-screen p-0' : 'min-h-[calc(100vh-8.5rem)] p-4'
      }`}
    >
      <DocSidebar
        docs={docs}
        folders={folders}
        activeDocId={activeDocId}
        hidden={fullscreen}
        onOpenDoc={openDoc}
        onCreateDoc={(folderId) => void handleCreateDoc(folderId)}
        onCreateFolder={(name) => void handleCreateFolder(name)}
        onRenameDoc={(id, title) => void handleRenameDoc(id, title)}
        onMoveDoc={(id, folderId) => void handleMoveDoc(id, folderId)}
        onDeleteDoc={(id) => void handleDeleteDoc(id)}
        onRenameFolder={(id, name) => void handleRenameFolder(id, name)}
        onDeleteFolder={(id) => void handleDeleteFolder(id)}
      />
      <div ref={areaRef} className="flex min-h-0 flex-1 flex-col">
        {ready ? (
        <>
        {/* Toolbar: view mode + source actions (available in every mode).
            Collapses away while scrolling the rendered document in preview
            mode — the toolbar is for doing things, not for reading. */}
        <div
          className={`overflow-hidden transition-all duration-300 ${
            chromeHidden || fullscreen ? 'mb-0 max-h-0 opacity-0' : 'mb-2 max-h-12 opacity-100'
          }`}
        >
        <div className="flex items-center justify-between gap-2">
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
              onClick={() => updateInput(sample)}
              className="ghost-btn flex items-center gap-1 px-2.5 py-1.5 text-xs"
              title={t('tools.markdown.sampleHint')}
            >
              <Sparkles size={13} />
              {t('tools.markdown.sample')}
            </button>
            <CopyButton text={input} />
            <div
              className="flex items-center rounded-lg border border-line bg-panel p-0.5 pl-1.5"
              title={t('tools.markdown.exportFullHint')}
            >
              <select
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                aria-label={t('tools.markdown.exportScale')}
                className="cursor-pointer bg-transparent text-xs font-semibold text-muted outline-none transition-colors duration-150 hover:text-ink"
              >
                {EXPORT_SCALES.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              <button
                onClick={exportFull}
                disabled={exporting || !showPreview}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${
                  exportFailed
                    ? 'text-danger'
                    : 'text-muted hover:bg-hover hover:text-ink'
                }`}
              >
                {exporting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <ImageDown size={13} />
                )}
                {exportFailed ? t('tools.markdown.exportFailed') : t('tools.markdown.exportFull')}
              </button>
            </div>
            {canShare && (
              <button
                onClick={() => void shareDoc()}
                disabled={sharing || !showPreview}
                title={t('tools.markdown.shareHint')}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-muted transition-colors duration-150 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
              >
                {sharing ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
                {sharing ? t('tools.markdown.sharing') : t('tools.markdown.share')}
              </button>
            )}
          </div>
        </div>
        </div>

        {mode === 'edit' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-[320px] min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel">
              <MarkdownEditor
                value={input}
                onChange={updateInput}
                autoFocus
                placeholder="# 标题

**加粗**、*斜体*、`代码`、[链接](https://loadix.dev)

```mermaid
flowchart LR
  A --> B
```"
              />
            </div>
          </div>
        ) : mode === 'preview' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              onDoubleClick={() => onToggleFullscreen?.()}
              className={`${
                fullscreen
                  ? 'min-h-screen overflow-auto bg-panel'
                  : 'min-h-[320px] flex-1 overflow-auto rounded-lg border border-line bg-panel px-6 py-4 sm:px-8 sm:py-6 md:px-10 md:py-8'
              }`}
            >
              {preview}
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 max-lg:grid-cols-1">
            <div className="flex min-h-0 flex-col">
              <div className="min-h-[260px] min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel">
                <MarkdownEditor
                  value={input}
                  onChange={updateInput}
                  placeholder="# 标题

**加粗**、*斜体*、`代码`、[链接](https://loadix.dev)

```mermaid
flowchart LR
  A --> B
```"
                />
              </div>
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="min-h-[260px] flex-1 overflow-auto rounded-lg border border-line bg-panel px-6 py-4">
                {preview}
              </div>
            </div>
          </div>
        )}
        </>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-line bg-panel text-sm text-muted">
            {t('tools.markdown.loadingDocs')}
          </div>
        )}
      </div>

      {shareDialog && (
        <ShareDialog
          dialog={shareDialog}
          onClose={() => setShareDialog(null)}
          onRetry={() => {
            setShareDialog(null);
            void shareDoc();
          }}
        />
      )}
    </div>
  );
}

/** State of the share-action dialog. */
type ShareDialogState =
  | { status: 'ready'; url: string; autoCopied: boolean }
  | { status: 'error'; reason: 'generic' | 'too-large' };

/**
 * Share result sheet. The link was copied as soon as it was created (see
 * shareDoc), so by the time the sheet opens the job is already done — it
 * confirms with ✓ 已复制 and keeps the URL handy for a re-copy or preview.
 * When the clipboard was denied, the URL is pre-selected so ⌘/Ctrl+C still
 * works, and the manual button remains.
 */
function ShareDialog({
  dialog,
  onClose,
  onRetry,
}: {
  dialog: ShareDialogState;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(() => dialog.status === 'ready' && dialog.autoCopied);
  const linkRef = useRef<HTMLInputElement>(null);
  const revertTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(revertTimerRef.current), []);

  // Select the whole link the moment it appears.
  useEffect(() => {
    if (dialog.status === 'ready') {
      const id = window.setTimeout(() => {
        linkRef.current?.focus();
        linkRef.current?.select();
      }, 40);
      return () => window.clearTimeout(id);
    }
  }, [dialog]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = async () => {
    if (dialog.status !== 'ready') return;
    const ok = await copyToClipboard(dialog.url);
    if (!ok) return; // link stays selected — Ctrl/Cmd+C still works
    setCopied(true);
    window.clearTimeout(revertTimerRef.current);
    revertTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-[min(420px,92vw)] rounded-xl border border-line bg-panel p-4 shadow-2xl"
      >
        <div className="mb-3.5 flex items-center justify-between">
          <h3 className="text-[14px] font-bold">{t('tools.markdown.shareDialogTitle')}</h3>
          <button
            onClick={onClose}
            aria-label={t('tools.markdown.shareDone')}
            className="cursor-pointer rounded-md p-1 text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        {dialog.status === 'ready' ? (
          <div className="flex items-center rounded-lg border border-line bg-panel pl-3 transition-colors duration-150 focus-within:border-primary">
            <input
              ref={linkRef}
              readOnly
              value={dialog.url}
              aria-label={t('tools.markdown.shareUrlLabel')}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full min-w-0 bg-transparent font-mono text-[12.5px] text-ink outline-none"
            />
            <button
              onClick={() => window.open(dialog.url, '_blank', 'noopener')}
              aria-label={t('tools.markdown.shareOpen')}
              title={t('tools.markdown.shareOpen')}
              className="shrink-0 cursor-pointer rounded-md p-2 text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              <ExternalLink size={14} />
            </button>
            <button
              onClick={() => void handleCopy()}
              className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2.5 py-2 text-xs font-semibold transition-colors duration-150 ${
                copied ? 'text-success' : 'text-primary hover:bg-primary/10'
              }`}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t('tools.copied') : t('tools.copy')}
            </button>
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-muted">
              {dialog.reason === 'too-large'
                ? t('tools.markdown.shareTooLarge')
                : t('tools.markdown.shareFailed')}
            </p>
            <div className="mt-4 flex justify-end">
              <button className="ghost-btn" onClick={onRetry}>
                {t('tools.markdown.shareRetry')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Writes text to the clipboard: Async Clipboard API first, then the legacy
 * textarea + execCommand path (covers insecure contexts and browsers without
 * the API). Never throws — resolves false when every path is denied so the
 * caller can fall back to its own affordance.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/* ——— Full-document export helpers ——— */

/**
 * Resolves once the offscreen preview has committed AND every mermaid block
 * has settled (rendered or errored). React 18 commits asynchronously, so an
 * empty host must not count as "ready" — otherwise the export can capture the
 * document before the diagrams exist.
 */
function waitForDiagrams(host: HTMLElement, timeoutMs = 12000): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const committed = host.querySelector('.md-prose') !== null;
      const pending = host.querySelectorAll('.md-mermaid-skeleton').length;
      if ((committed && pending === 0) || Date.now() - start > timeoutMs) {
        resolve();
      } else {
        window.setTimeout(tick, 100);
      }
    };
    tick();
  });
}

/** Reads a blob as a data URL (for embedding raster diagrams in the capture). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'));
    fr.readAsDataURL(blob);
  });
}

/** Triggers a browser download for the blob. */
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** loadix-markdown-YYYYMMDD-HHmmss.png */
function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}