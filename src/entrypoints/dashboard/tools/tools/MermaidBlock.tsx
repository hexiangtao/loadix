import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
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
 */
export function MermaidBlock({ source }: MermaidBlockProps) {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const [state, setState] = useState<RenderState>({ status: 'loading' });
  const tokenRef = useRef(0);

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

  if (state.status === 'ready') {
    // The SVG is produced by mermaid's own sanitizer (securityLevel: 'strict').
    // eslint-disable-next-line react/no-danger
    return <div className="md-mermaid" dangerouslySetInnerHTML={{ __html: state.svg }} />;
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