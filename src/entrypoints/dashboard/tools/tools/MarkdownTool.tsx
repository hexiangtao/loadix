import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { toPng } from 'html-to-image';
import {
  Columns2,
  Eye,
  ImageDown,
  Loader2,
  PencilLine,
  Sparkles,
  TextQuote,
  type LucideIcon,
} from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';
import { MarkdownPreview } from './MarkdownPreview';
import { flattenForExport, svgToPng } from './MermaidBlock';
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

export function MarkdownTool({ initialPayload }: MarkdownToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('markdown.input', initialPayload ?? '');
  const [mode, setMode] = useViewMode();
  const [scale, setScale] = useState(2);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);
  const failTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(failTimerRef.current), []);

  const showPreview = input.trim().length > 0;

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

  return (
    <ToolShell icon={TextQuote} title={t('tools.markdown.name')}>
      <div ref={areaRef} className="flex min-h-0 flex-1 flex-col">
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