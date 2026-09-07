import {
  isValidElement,
  memo,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { useTranslation } from 'react-i18next';
import { Check, Copy, X } from 'lucide-react';
import { MermaidBlock } from './MermaidBlock';
import 'katex/dist/katex.min.css';
import './markdown.css';

interface MarkdownPreviewProps {
  source: string;
  /** Click-to-zoom for rendered media (mermaid diagrams AND images) — used by
      the read-only share viewer; the dashboard's own preview stays plain. */
  zoomable?: boolean;
}

/**
 * Full-strength markdown renderer:
 *  - remark-gfm     → tables, task lists, strikethrough, autolinks
 *  - remark/rehype-math + katex → LaTeX inline and display math
 *  - rehype-highlight → syntax highlighting (GitHub light/dark ramps)
 *  - ```mermaid blocks → live diagrams (lazy-loaded engine, theme-aware)
 *
 * Component overrides add the touches regex renderers can't: external links
 * open in a new tab, fenced code becomes a card with a language label + copy,
 * and wide tables scroll instead of breaking the layout.
 */
export const MarkdownPreview = memo(function MarkdownPreview({
  source,
  zoomable = false,
}: MarkdownPreviewProps) {
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  return (
    <div className="md-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          code: (props) => <Code {...props} zoomable={zoomable} />,
          a: Link,
          table: Table,
          img: zoomable
            ? (props) => <ZoomableImg {...props} onZoom={(src, alt) => setZoom({ src, alt })} />
            : undefined,
        }}
      >
        {source}
      </ReactMarkdown>
      {zoom && <ImageZoom {...zoom} onClose={() => setZoom(null)} />}
    </div>
  );
});

/* ——— Component overrides ——— */

type CodeProps = ComponentPropsWithoutRef<'code'> & { node?: unknown; zoomable?: boolean };

/** Fenced blocks (language-* className) become code cards; mermaid becomes a diagram. */
function Code({ className, children, node: _node, zoomable = false, ...props }: CodeProps) {
  const match = /language-([\w-]+)/.exec(className ?? '');
  if (match) {
    const lang = match[1] ?? '';
    const source = rawText(children);
    if (lang === 'mermaid') return <MermaidBlock source={source} zoomable={zoomable} />;
    return (
      <CodeBlock lang={lang} source={source} className={className}>
        {children}
      </CodeBlock>
    );
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

function CodeBlock({
  lang,
  source,
  className,
  children,
}: {
  lang: string;
  source: string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = source;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="md-codeblock">
      <div className="md-codeblock-head">
        <span className="md-codeblock-lang">{lang}</span>
        <button
          type="button"
          onClick={copy}
          className={`md-codeblock-copy${copied ? ' copied' : ''}`}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? t('tools.copied') : t('tools.copy')}
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

type LinkProps = ComponentPropsWithoutRef<'a'> & { node?: unknown };

/** External links open in a new tab; same-document (#) and mailto links stay. */
function Link({ node: _node, href, children, ...props }: LinkProps) {
  const external = !!href && !href.startsWith('#') && !href.startsWith('mailto:');
  return (
    <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} {...props}>
      {children}
    </a>
  );
}

type ImgProps = ComponentPropsWithoutRef<'img'> & { node?: unknown };

/** Click-to-zoom wrapper for images in zoomable contexts (the share viewer).
    The whole image opens the shared .md-zoom lightbox; images nested inside
    a link keep normal link behavior. */
function ZoomableImg({
  node: _node,
  src,
  alt,
  onZoom,
  ...props
}: ImgProps & { onZoom: (src: string, alt: string) => void }) {
  return (
    <img
      {...props}
      src={src}
      alt={alt ?? ''}
      draggable={false}
      className="md-zoomable-img"
      onClick={(e) => {
        if (src && !(e.target as HTMLElement).closest('a')) onZoom(src, alt ?? '');
      }}
    />
  );
}

/** Fullscreen image preview — the same .md-zoom* chrome as the diagram
    lightbox, showing the image at natural resolution (capped to the
    viewport). Closes via ✕, Esc, or clicking the scrim; scroll is locked. */
function ImageZoom({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="md-zoom"
      role="dialog"
      aria-modal="true"
      aria-label={alt || t('tools.markdown.zoomImage')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="md-zoom-box">
        <div className="md-zoom-toolbar">
          <button
            type="button"
            className="md-zoom-btn"
            onClick={onClose}
            autoFocus
            aria-label={t('tools.markdown.zoomClose')}
            title={t('tools.markdown.zoomClose')}
          >
            <X size={16} />
          </button>
        </div>
        <div className="md-zoom-scroll">
          <div className="md-zoom-img">
            <img src={src} alt={alt} />
          </div>
        </div>
        <p className="md-zoom-hint">{t('tools.markdown.zoomHint')}</p>
      </div>
    </div>
  );
}

type TableProps = ComponentPropsWithoutRef<'table'> & { node?: unknown };

/** Wrap tables so wide ones scroll horizontally inside the preview pane. */
function Table({ node: _node, ...props }: TableProps) {
  return (
    <div className="md-table-wrap">
      <table {...props} />
    </div>
  );
}

/* ——— Helpers ——— */

/** Recovers the plain source text from highlighted (span-wrapped) children. */
function rawText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(rawText).join('');
  if (isValidElement(children)) {
    const props = children.props as { children?: ReactNode };
    return rawText(props.children);
  }
  return '';
}