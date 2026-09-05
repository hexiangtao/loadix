import { Fragment, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView, keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { redo, undo } from '@codemirror/commands';
import { useTranslation } from 'react-i18next';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Sigma,
  SquareCode,
  Strikethrough,
  Table2,
  Undo2,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { markdownSmartInput } from './markdownSmartInput';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Rich Markdown source editor built on CodeMirror 6:
 *  - GFM language (tables, task lists, strikethrough) with syntax highlighting
 *  - Lazy-loaded language support inside fenced code blocks (js, python, …)
 *  - Smart typing: `` ` `` and `**` auto-pair, Enter continues list items,
 *    Tab indents / nests list items
 *  - Formatting toolbar that wraps/prefixes the current selection
 *  - Keyboard shortcuts: ⌘/Ctrl+B bold, ⌘/Ctrl+I italic, ⌘/Ctrl+Shift+X strike
 *
 * The editor is deliberately source-based rather than WYSIWYG: the document
 * stays a plain string, so the existing preview / PNG export / share pipeline
 * keeps working unchanged.
 */
export function MarkdownEditor({ value, onChange, placeholder, autoFocus }: MarkdownEditorProps) {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const viewRef = useRef<EditorView | null>(null);

  const run = (action: (view: EditorView) => void) => {
    const view = viewRef.current;
    if (!view) return;
    action(view);
  };

  const actions = useMemo(() => buildActions(t), [t]);

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      editorTheme,
      syntaxHighlighting(markdownHighlight),
      markdownSmartInput,
      keymap.of([
        { key: 'Mod-b', run: (view) => (actions.bold(view), true) },
        { key: 'Mod-i', run: (view) => (actions.italic(view), true) },
        { key: 'Mod-Shift-x', run: (view) => (actions.strike(view), true) },
      ]),
    ],
    [actions]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Formatting toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
        {TOOLBAR_GROUPS.map((group, gi) => (
          <Fragment key={group[0]!.label}>
            {gi > 0 && <div className="mx-1 h-4 w-px shrink-0 bg-line" />}
            {group.map((btn) => (
              <button
                key={btn.label}
                type="button"
                title={btn.titleKey ? t(btn.titleKey) : btn.label}
                aria-label={btn.titleKey ? t(btn.titleKey) : btn.label}
                onClick={() => run(actions[btn.action])}
                className="flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
              >
                <btn.icon size={13} />
              </button>
            ))}
          </Fragment>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeMirror
          className="h-full"
          value={value}
          onChange={onChange}
          extensions={extensions}
          height="100%"
          placeholder={placeholder}
          autoFocus={autoFocus}
          theme="none"
          onCreateEditor={(view) => {
            viewRef.current = view;
          }}
          onUpdate={(vu) => {
            // Drop the reference when the view is destroyed (mode switch).
            if (vu.docChanged && !viewRef.current) viewRef.current = vu.view;
          }}
        />
      </div>
    </div>
  );
}

/* ——— Toolbar definition ——— */

type ActionName =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'link'
  | 'image'
  | 'table'
  | 'codeBlock'
  | 'mermaid'
  | 'math'
  | 'hr';

interface ToolbarButton {
  icon: LucideIcon;
  label: string;
  titleKey?: string;
  action: ActionName;
}

type ToolbarGroup = ToolbarButton[];

const RAW_TOOLBAR_GROUPS: ToolbarGroup[] = [
  [
    { icon: Undo2, label: 'undo', action: 'undo' },
    { icon: Redo2, label: 'redo', action: 'redo' },
  ],
  [
    { icon: Bold, label: 'bold', action: 'bold' },
    { icon: Italic, label: 'italic', action: 'italic' },
    { icon: Strikethrough, label: 'strike', action: 'strike' },
    { icon: Code, label: 'inlineCode', action: 'inlineCode' },
  ],
  [
    { icon: Heading1, label: 'H1', action: 'h1' },
    { icon: Heading2, label: 'H2', action: 'h2' },
    { icon: Heading3, label: 'H3', action: 'h3' },
  ],
  [
    { icon: Quote, label: 'quote', action: 'quote' },
    { icon: List, label: 'bulletList', action: 'bulletList' },
    { icon: ListOrdered, label: 'orderedList', action: 'orderedList' },
    { icon: ListChecks, label: 'taskList', action: 'taskList' },
  ],
  [
    { icon: Link, label: 'link', action: 'link' },
    { icon: Image, label: 'image', action: 'image' },
    { icon: Table2, label: 'table', action: 'table' },
    { icon: SquareCode, label: 'codeBlock', action: 'codeBlock' },
    { icon: Workflow, label: 'mermaid', action: 'mermaid' },
    { icon: Sigma, label: 'math', action: 'math' },
    { icon: Minus, label: 'hr', action: 'hr' },
  ],
];

const TOOLBAR_GROUPS: ToolbarGroup[] = RAW_TOOLBAR_GROUPS.map((group) =>
  group.map((btn) => ({
    ...btn,
    titleKey: `tools.markdown.edit.${btn.action}`,
  }))
);

/* ——— Selection helpers ——— */

interface Sel {
  from: number;
  to: number;
  selected: string;
  empty: boolean;
}

function sel(view: EditorView): Sel {
  const { from, to } = view.state.selection.main;
  return { from, to, selected: view.state.sliceDoc(from, to), empty: from === to };
}

/** Wraps the selection with before/after; with an empty selection inserts a placeholder and selects it. */
function wrap(view: EditorView, before: string, after: string, placeholder = '') {
  const { from, to, selected, empty } = sel(view);
  const insert = empty ? before + placeholder + after : before + selected + after;
  const anchor = from + before.length;
  const head = anchor + (empty ? placeholder.length : selected.length);
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor, head },
    scrollIntoView: true,
  });
  view.focus();
}

/** Inserts text at the cursor and moves the caret to the given offset. */
function insertAt(view: EditorView, text: string, caretOffset: number) {
  const { from } = view.state.selection.main;
  view.dispatch({
    changes: { from, to: from, insert: text },
    selection: { anchor: from + caretOffset },
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * Sets (or toggles off) a heading level on every touched line: a line that
 * already has the exact level gets its prefix stripped; any other heading
 * prefix is replaced by the requested level.
 */
function setHeading(view: EditorView, level: number) {
  const prefix = '#'.repeat(level) + ' ';
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let ln = startLine.number; ln <= endLine.number; ln++) {
    const line = view.state.doc.line(ln);
    const m = /^#{1,6}\s*/.exec(line.text);
    if (m && m[0].trim() === '#'.repeat(level)) {
      // Same level → toggle off.
      changes.push({ from: line.from, to: line.from + m[0].length, insert: '' });
    } else {
      const rep = m ? m[0].length : 0;
      changes.push({ from: line.from, to: line.from + rep, insert: prefix });
    }
  }
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

/** Toggles a prefix on every line touched by the selection. */
function toggleLinePrefix(view: EditorView, prefix: string, existing: RegExp, replace?: RegExp) {
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let ln = startLine.number; ln <= endLine.number; ln++) {
    const line = view.state.doc.line(ln);
    const m = existing.exec(line.text);
    if (m) {
      // Already prefixed → strip it.
      changes.push({ from: line.from, to: line.from + m[0].length, insert: '' });
    } else {
      const rep = replace?.exec(line.text);
      changes.push({
        from: line.from,
        to: rep ? line.from + rep[0].length : line.from,
        insert: prefix,
      });
    }
  }
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

/* ——— Actions ——— */

type TFunction = (key: string) => string;

type Actions = Record<ActionName, (view: EditorView) => void>;

function buildActions(t: TFunction): Actions {
  const inlineWrap = (before: string, after: string, placeholder: string) => (view: EditorView) =>
    wrap(view, before, after, placeholder);

  const link = (view: EditorView) => {
    const { from, to, selected, empty } = sel(view);
    const text = empty ? t('tools.markdown.edit.linkText') : selected;
    const url = t('tools.markdown.edit.linkUrl');
    const insert = `[${text}](${url})`;
    // Select the URL part so typing replaces it.
    const urlStart = from + insert.indexOf('(') + 1;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: urlStart, head: urlStart + url.length },
      scrollIntoView: true,
    });
    view.focus();
  };

  const image = (view: EditorView) => {
    const { from, to, selected, empty } = sel(view);
    const alt = empty ? t('tools.markdown.edit.imageAlt') : selected;
    const url = t('tools.markdown.edit.linkUrl');
    const insert = `![${alt}](${url})`;
    const urlStart = from + insert.indexOf('(') + 1;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: urlStart, head: urlStart + url.length },
      scrollIntoView: true,
    });
    view.focus();
  };

  const table = (view: EditorView) => {
    const col = t('tools.markdown.edit.tableCol');
    const header = `| ${col}1 | ${col}2 | ${col}3 |`;
    const sep = '| --- | --- | --- |';
    const row = '|  |  |  |';
    const block = `\n${header}\n${sep}\n${row}\n`;
    // Drop the caret into the first cell of the first data row.
    const caret = 1 + header.length + 1 + sep.length + 1 + 2;
    insertAt(view, block, caret);
  };

  const codeBlock = (view: EditorView) => {
    const { from, to, selected, empty } = sel(view);
    if (empty) {
      insertAt(view, '```\n\n```', 4);
    } else {
      const insert = '```\n' + selected + '\n```';
      const anchor = from + 4;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor, head: anchor + selected.length },
        scrollIntoView: true,
      });
      view.focus();
    }
  };

  const mermaid = (view: EditorView) => {
    const body = 'flowchart LR\n  A[开始] --> B[处理]\n  B --> C[结束]';
    const block = '```mermaid\n' + body + '\n```';
    const { from, to, selected } = sel(view);
    if (selected) {
      const insert = '```mermaid\n' + selected + '\n```';
      const anchor = from + 11;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor, head: anchor + selected.length },
        scrollIntoView: true,
      });
      view.focus();
    } else {
      // Insert the template and select the diagram body so typing replaces it.
      const anchor = from + 11;
      view.dispatch({
        changes: { from, to: from, insert: block },
        selection: { anchor, head: anchor + body.length },
        scrollIntoView: true,
      });
      view.focus();
    }
  };

  const math = (view: EditorView) => {
    const { from, to, selected, empty } = sel(view);
    if (empty) {
      insertAt(view, '$$\n\n$$', 3);
    } else {
      const insert = '$$\n' + selected + '\n$$';
      const anchor = from + 3;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor, head: anchor + selected.length },
        scrollIntoView: true,
      });
      view.focus();
    }
  };

  const hr = (view: EditorView) => {
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const atLineStart = line.from === from;
    const insert = atLineStart ? '---\n' : '\n---\n';
    insertAt(view, insert, insert.length);
  };

  return {
    undo: (view) => {
      undo(view);
      view.focus();
    },
    redo: (view) => {
      redo(view);
      view.focus();
    },
    bold: inlineWrap('**', '**', t('tools.markdown.edit.boldText')),
    italic: inlineWrap('*', '*', t('tools.markdown.edit.italicText')),
    strike: inlineWrap('~~', '~~', t('tools.markdown.edit.strikeText')),
    inlineCode: inlineWrap('`', '`', t('tools.markdown.edit.codeText')),
    h1: (view) => setHeading(view, 1),
    h2: (view) => setHeading(view, 2),
    h3: (view) => setHeading(view, 3),
    quote: (view) => toggleLinePrefix(view, '> ', /^> /),
    bulletList: (view) => toggleLinePrefix(view, '- ', /^\s*[-*+]\s+/, /^\s*\d+\.\s+/),
    orderedList: (view) => toggleLinePrefix(view, '1. ', /^\s*\d+\.\s+/, /^\s*[-*+]\s+/),
    taskList: (view) => toggleLinePrefix(view, '- [ ] ', /^\s*[-*+]\s+\[[ xX]\]\s+/),
    link,
    image,
    table,
    codeBlock,
    mermaid,
    math,
    hr,
  };
}

/* ——— CodeMirror theme & highlighting ——— */

/**
 * Editor chrome follows the app palette through CSS variables, so light and
 * dark mode both work without rebuilding the extension.
 */
const editorTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--color-ink)',
      backgroundColor: 'transparent',
      height: '100%',
      fontSize: '13px',
    },
    '.cm-content': {
      fontFamily:
        "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Liberation Mono', monospace",
      padding: '10px 2px',
      caretColor: 'var(--color-primary)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-primary)' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--color-muted)',
      border: 'none',
      borderRight: '1px solid var(--color-line)',
    },
    '.cm-activeLine': { backgroundColor: 'var(--color-hover)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--color-hover)', color: 'var(--color-ink)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--color-primary) 22%, transparent)',
    },
    '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 28%, transparent)' },
    '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 40%, transparent)' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--color-hover)', color: 'var(--color-muted)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--color-panel)',
      border: '1px solid var(--color-line)',
      color: 'var(--color-ink)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--color-hover)',
      color: 'var(--color-ink)',
    },
    '.cm-placeholder': { color: 'var(--color-muted)' },
  },
  { dark: false }
);

/**
 * Markdown + common code token colors, all through CSS variables so the
 * editor matches the surrounding light/dark theme. Headings and inline code
 * stand out; block markup stays muted so the document structure reads at a
 * glance.
 */
const markdownHighlight = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3], color: 'var(--color-ink)', fontWeight: '700' },
  { tag: [t.heading4, t.heading5, t.heading6], color: 'var(--color-muted)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, color: 'var(--color-muted)', textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--color-primary)' },
  { tag: t.url, color: 'var(--color-primary)' },
  { tag: t.monospace, color: 'var(--color-danger)' },
  { tag: t.quote, color: 'var(--color-muted)', fontStyle: 'italic' },
  { tag: t.contentSeparator, color: 'var(--color-muted)' },
  { tag: t.processingInstruction, color: 'var(--color-muted)' },
  { tag: t.labelName, color: 'var(--color-primary)' },
  { tag: t.list, color: 'var(--color-muted)' },
  { tag: t.escape, color: 'var(--color-muted)' },
  { tag: t.comment, color: 'var(--color-muted)', fontStyle: 'italic' },
  // Common code tokens (used inside fenced blocks with a matched language).
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: 'var(--color-primary)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--color-success)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--color-warning)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--color-primary)' },
  { tag: [t.typeName, t.className], color: 'var(--color-warning)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--color-ink)' },
  { tag: [t.operator, t.punctuation], color: 'var(--color-muted)' },
  { tag: t.variableName, color: 'var(--color-ink)' },
  { tag: t.definition(t.variableName), color: 'var(--color-ink)' },
]);