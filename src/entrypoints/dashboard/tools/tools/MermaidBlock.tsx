import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';

interface MermaidBlockProps {
  source: string;
}

type RenderState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; message: string };

/**
 * Renders a ```mermaid fenced block. The diagram engine (~1.2 MB) is loaded
 * lazily via dynamic import so it never taxes the initial bundle — it only
 * arrives when a diagram is actually on screen.
 *
 * While the user edits, re-renders are debounced; while a fresh render is
 * in flight the previous SVG stays visible (no flicker). A monotonically
 * increasing token guards against out-of-order async completions. Theme is
 * taken from the app's UI store so diagrams match the current light/dark
 * palette and re-render when it flips.
 *
 * Each rendered diagram gets a hover-revealed export button (top-right
 * corner). Export first flattens mermaid's <foreignObject> labels into real
 * <text> elements — browsers refuse to paint foreignObject when an SVG is
 * rasterized as an image, so without that step every PNG would come out
 * missing its labels — then rasterizes the SVG to PNG at 2x for crisp text.
 */
export function MermaidBlock({ source }: MermaidBlockProps) {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const [state, setState] = useState<RenderState>({ status: 'loading' });
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const tokenRef = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const failTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const trimmed = source.trim();
    if (!trimmed) {
      setState({ status: 'loading' });
      return;
    }

    let cancelled = false;
    const token = ++tokenRef.current;

    const timer = window.setTimeout(() => {
      setState({ status: 'loading' });
      void (async () => {
        try {
          // Lazy-load the engine (first diagram pays the import cost).
          const { default: mermaid } = await import('mermaid');
          mermaid.initialize({
            startOnLoad: false,
            theme: theme === 'dark' ? 'dark' : 'default',
            securityLevel: 'strict',
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, ui-sans-serif, system-ui, sans-serif",
          });
          // Unique id per call — mermaid caches by id and warns on reuse.
          const { svg } = await mermaid.render(`md-${token}-${Date.now()}`, trimmed);
          if (!cancelled && token === tokenRef.current) setState({ status: 'ready', svg });
        } catch (e) {
          if (!cancelled && token === tokenRef.current) {
            setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
          }
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, theme]);

  useEffect(() => () => window.clearTimeout(failTimerRef.current), []);

  const exportPng = async () => {
    const svg = boxRef.current?.querySelector('svg');
    if (!svg || exporting) return;
    setExporting(true);
    setExportFailed(false);
    try {
      const flat = flattenForExport(svg as unknown as SVGSVGElement);
      const blob = await svgToPng(flat);
      downloadBlob(blob, diagramFileName(flat, source));
    } catch (e) {
      console.error('[markdown] PNG export failed:', e);
      setExportFailed(true);
      window.clearTimeout(failTimerRef.current);
      failTimerRef.current = window.setTimeout(() => setExportFailed(false), 2600);
    } finally {
      setExporting(false);
    }
  };

  if (state.status === 'ready') {
    return (
      <div className="md-mermaid-wrap">
        <div className="md-mermaid" ref={boxRef}>
          <div className="md-mermaid-svg" dangerouslySetInnerHTML={{ __html: state.svg }} />
        </div>
        <button
          type="button"
          className={`md-mermaid-export${exportFailed ? ' failed' : ''}`}
          onClick={exportPng}
          disabled={exporting}
          title={t('tools.markdown.exportImage')}
        >
          {exporting ? <span className="md-mermaid-export-spin" /> : <Download size={13} />}
          {exportFailed ? t('tools.markdown.exportFailed') : t('tools.markdown.exportImage')}
        </button>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="md-mermaid-error">
        <div className="md-mermaid-error-head">
          <AlertTriangle size={14} />
          {t('tools.markdown.diagramError')}
        </div>
        <pre>{source}</pre>
      </div>
    );
  }

  return (
    <div className="md-mermaid">
      <div className="md-mermaid-skeleton">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
    </div>
  );
}

/* ——— PNG export pipeline ——— */

/**
 * Produces a standalone copy of the rendered diagram whose foreignObject
 * labels have been flattened into plain <text> elements. Canvas rasterization
 * (and the SVG-as-image spec) drop foreignObject content entirely, so this
 * step is what makes exported PNGs actually contain their labels.
 */
export function flattenForExport(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.querySelectorAll('script').forEach((el) => el.remove());

  // Mermaid sizes diagrams via width="100%" + style="max-width: Npx". An SVG
  // used as an image needs concrete numeric dimensions; the viewBox provides
  // the natural size. The max-width cap is stripped so the rasterizer renders
  // at full resolution (we scale up to 2x ourselves).
  const vb = clone.viewBox.baseVal;
  const w = clone.getAttribute('width');
  const h = clone.getAttribute('height');
  if (!/^\d+(\.\d+)?$/.test(w ?? '')) clone.setAttribute('width', String(vb.width || 0));
  if (!/^\d+(\.\d+)?$/.test(h ?? '')) clone.setAttribute('height', String(vb.height || 0));
  const style = clone.getAttribute('style');
  if (style) {
    const cleaned = style
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s && !/^max-width/i.test(s))
      .join(';');
    if (cleaned) clone.setAttribute('style', cleaned);
    else clone.removeAttribute('style');
  }

  // Live and clone trees are identical copies (same order), so parallel
  // iteration matches each foreignObject. Computed styles must be read from
  // the LIVE nodes — detached clones have no stylesheet-derived styles.
  const liveFos = Array.from(svg.querySelectorAll('foreignObject'));
  const cloneFos = Array.from(clone.querySelectorAll('foreignObject'));
  liveFos.forEach((fo, i) => {
    const cloneFo = cloneFos[i];
    if (!cloneFo) return;
    const textEl = textFromForeignObject(svg, fo);
    // Labels carry ABSOLUTE coordinates (measured via live layout), so they
    // must be appended to the svg root — replacing the foreignObject in place
    // would inherit the node groups' translate() transforms and double-shift
    // every label below its node.
    cloneFo.remove();
    if (textEl) clone.appendChild(textEl);
  });

  return clone;
}

/**
 * Builds a styled <text> (with tspan lines) mirroring a foreignObject label.
 *
 * Mermaid positions labels purely via ancestor <g transform> chains — the
 * foreignObject carries no x/y attributes — so the anchor point is measured
 * from live layout (getBoundingClientRect, which already includes every
 * transform and the page's own display scaling) and mapped back into the
 * SVG's user coordinate system through the viewBox.
 */
function textFromForeignObject(
  svg: SVGSVGElement,
  fo: SVGForeignObjectElement,
): SVGTextElement | null {
  const div = fo.querySelector('div');
  if (!div) return null;

  const lines = textLines(div);
  if (!lines.length || lines.every((l) => !l.trim())) return null;

  const box = foreignObjectBox(svg, fo);
  if (!box) return null;

  const style = getComputedStyle(div);
  const anchor = style.textAlign === 'left' ? 'start' : style.textAlign === 'right' ? 'end' : 'middle';
  const cx =
    anchor === 'start' ? box.left + 6 : anchor === 'end' ? box.left + box.width - 6 : box.left + box.width / 2;
  const cy = box.top + box.height / 2;

  const ns = 'http://www.w3.org/2000/svg';
  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', String(cx));
  text.setAttribute('y', String(cy));
  text.setAttribute('text-anchor', anchor);
  text.setAttribute('dominant-baseline', 'central');
  text.setAttribute('font-family', style.fontFamily);
  text.setAttribute('font-size', style.fontSize);
  text.setAttribute('font-weight', style.fontWeight);
  if (style.fontStyle !== 'normal') text.setAttribute('font-style', style.fontStyle);
  if (style.letterSpacing !== 'normal') text.setAttribute('letter-spacing', style.letterSpacing);
  text.setAttribute('fill', style.color);

  lines.forEach((line, i) => {
    const tspan = document.createElementNS(ns, 'tspan');
    tspan.setAttribute('x', String(cx));
    if (i > 0) tspan.setAttribute('dy', '1.2em');
    tspan.textContent = line;
    text.appendChild(tspan);
  });
  return text;
}

/** Splits a label's HTML into lines (<br> breaks), stripping span markup. */
function textLines(div: HTMLElement): string[] {
  const html = div.innerHTML.replace(/<br\s*\/?>/gi, '\n');
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent?.split('\n') ?? [];
}

/** Measures a foreignObject's box in SVG user units via live layout + viewBox. */
function foreignObjectBox(
  svg: SVGSVGElement,
  fo: SVGForeignObjectElement,
): { left: number; top: number; width: number; height: number } | null {
  const svgRect = svg.getBoundingClientRect();
  const foRect = fo.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return null;
  const vb = svg.viewBox.baseVal;
  const sx = svgRect.width / (vb.width || svgRect.width);
  const sy = svgRect.height / (vb.height || svgRect.height);
  const width = parseFloat(fo.getAttribute('width') ?? '') || foRect.width / sx;
  const height = parseFloat(fo.getAttribute('height') ?? '') || foRect.height / sy;
  return {
    left: (foRect.left - svgRect.left) / sx + vb.x,
    top: (foRect.top - svgRect.top) / sy + vb.y,
    width,
    height,
  };
}

/** Rasterizes the standalone SVG to a PNG blob at the given scale. */
export function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const width = parseFloat(svg.getAttribute('width') ?? '');
  const height = parseFloat(svg.getAttribute('height') ?? '');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return Promise.reject(new Error('Diagram has no measurable size'));
  }
  const text = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        cleanup();
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
      } catch (e) {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Could not rasterize the diagram'));
    };
    img.src = url;
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

/** loadix-<diagram-type>-<timestamp>.png — type from svg class, else from source. */
function diagramFileName(svg: SVGSVGElement, source: string): string {
  const cls = svg.getAttribute('class') ?? '';
  const type =
    cls
      .split(/\s+/)
      .find((c) => /^(flowchart|sequence|class|state|gantt|pie|er|journey|mindmap|timeline|git|quadrant|sankey|xychart|block)/i.test(c)) ??
    diagramTypeFromSource(source) ??
    'diagram';
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `loadix-${type}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
}

/** Recognizes the diagram kind from the mermaid source's opening keyword. */
function diagramTypeFromSource(source: string): string | null {
  const m = /^\s*(flowchart|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|gantt|pie|erDiagram|journey|mindmap|timeline|gitGraph|quadrantChart|sankey-beta|sankey|xychart-beta|xychart|block|C4Context)\b/m.exec(
    source,
  );
  if (!m) return null;
  const kw = (m[1] ?? '').toLowerCase();
  if (kw.startsWith('sequence')) return 'sequence';
  if (kw.startsWith('class')) return 'class';
  if (kw.startsWith('state')) return 'state';
  if (kw.startsWith('quadrant')) return 'quadrant';
  if (kw.startsWith('sankey')) return 'sankey';
  if (kw.startsWith('xychart')) return 'xychart';
  if (kw.startsWith('c4')) return 'c4';
  return kw;
}