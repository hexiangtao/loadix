import { useTranslation } from 'react-i18next';
import { TextQuote } from 'lucide-react';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';

interface MarkdownToolProps {
  initialPayload?: string;
}

/**
 * Tiny zero-dependency Markdown renderer for headings, bold, italic, code
 * (inline + block), links, lists, blockquotes and line breaks. Plenty for
 * previews of commit messages, READMEs, comments and changelogs.
 */
function renderMarkdown(src: string): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  let out = escape(src);

  // Code blocks first (before inline rules so inner * is not mangled).
  out = out.replace(/```([\s\S]*?)```/g, (_, code) => `<pre class="my-2 overflow-auto rounded-md bg-hover p-3 font-mono text-[12px]">${code.replace(/\n$/, '')}</pre>`);

  // Blockquotes (one per line).
  out = out.replace(/(^|\n)(?:&gt; ?[^\n]+\n?)+/g, (block) => {
    const inner = block.replace(/(^|\n)&gt; ?/g, '$1');
    return `${block.startsWith('\n') ? '' : ''}<blockquote class="my-2 border-l-2 border-primary/40 pl-3 text-muted">${inner.trimEnd()}</blockquote>`;
  });

  // Headings.
  out = out.replace(/^###### (.*)$/gm, '<h6 class="mt-3 text-xs font-bold">$1</h6>');
  out = out.replace(/^##### (.*)$/gm, '<h5 class="mt-3 text-sm font-bold">$1</h5>');
  out = out.replace(/^#### (.*)$/gm, '<h4 class="mt-3 text-sm font-bold">$1</h4>');
  out = out.replace(/^### (.*)$/gm, '<h3 class="mt-4 text-base font-bold">$1</h3>');
  out = out.replace(/^## (.*)$/gm, '<h2 class="mt-4 text-lg font-bold">$1</h2>');
  out = out.replace(/^# (.*)$/gm, '<h1 class="mt-5 text-xl font-bold">$1</h1>');

  // Unordered lists.
  out = out.replace(/(^|\n)((?:[-*+] .+\n?)+)/g, (_, prefix, block) => {
    const items = block.trim().split('\n').map((l: string) => `<li class="ml-4 list-disc">${l.replace(/^[-*+] /, '')}</li>`).join('');
    return `${prefix}<ul class="my-2">${items}</ul>`;
  });

  // Inline code.
  out = out.replace(/`([^`\n]+)`/g, '<code class="rounded bg-hover px-1.5 py-0.5 font-mono text-[12px]">$1</code>');
  // Bold.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic.
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  // Links.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="text-primary underline" href="$2" target="_blank" rel="noreferrer">$1</a>');
  // Line breaks.
  out = out.replace(/\n/g, '<br/>');

  return out;
}

export function MarkdownTool({ initialPayload }: MarkdownToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('markdown.input', initialPayload ?? '');

  const html = input.trim() ? renderMarkdown(input) : '';

  return (
    <ToolShell icon={TextQuote} title={t('tools.markdown.name')}>
      <div className="grid flex-1 grid-cols-2 gap-3 max-lg:grid-cols-1">
        <div className="flex min-h-0 flex-col">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-semibold text-muted">{t('tools.markdown.source')}</label>
            <CopyButton text={input} />
          </div>
          <textarea
            autoFocus
            className="min-h-[260px] w-full flex-1 resize-y rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-sm outline-none transition-colors duration-150 focus:border-primary"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="# Title&#10;&#10;**bold** and *italic*"
          />
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-semibold text-muted">{t('tools.markdown.preview')}</label>
            {html && <CopyButton text={html} />}
          </div>
          <div
            className="min-h-[260px] flex-1 overflow-auto rounded-lg border border-line bg-hover px-4 py-3 text-sm leading-relaxed"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: html || `<span class="text-muted">${t('tools.markdown.empty')}</span>` }}
          />
        </div>
      </div>
    </ToolShell>
  );
}
