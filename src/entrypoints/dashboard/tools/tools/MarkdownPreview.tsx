import {
  isValidElement,
  memo,
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
import { Check, Copy } from 'lucide-react';
import { MermaidBlock } from './MermaidBlock';
import 'katex/dist/katex.min.css';
import './markdown.css';

interface MarkdownPreviewProps {
  source: string;
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
export const MarkdownPreview = memo(function MarkdownPreview({ source }: MarkdownPreviewProps) {
  return (
    <div className="md-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          code: Code,
          a: Link,
          table: Table,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});

/* ——— Component overrides ——— */

type CodeProps = ComponentPropsWithoutRef<'code'> & { node?: unknown };

/** Fenced blocks (language-* className) become code cards; mermaid becomes a diagram. */
function Code({ className, children, node: _node, ...props }: CodeProps) {
  const match = /language-([\w-]+)/.exec(className ?? '');
  if (match) {
    const lang = match[1] ?? '';
    const source = rawText(children);
    if (lang === 'mermaid') return <MermaidBlock source={source} />;
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