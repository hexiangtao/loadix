import { Prec, type ChangeSpec, type EditorState, type Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { EditorView, keymap, type Command } from '@codemirror/view';

/**
 * Smart input for the Markdown source editor:
 *
 *  - **Delimiter pairing** — typing `` ` `` (inline code) or `*` (emphasis)
 *    auto-inserts the closing delimiter and places the caret inside; typing
 *    the closing delimiter right before an already-pending one skips over it.
 *    Typing `**` (or a third `*` for `***`) grows the opener and its matching
 *    closer together, and fencing a code block (three backticks) stays plain.
 *
 *  - **List auto-continuation** — Enter on a bullet / ordered / task-list line
 *    starts the next item with the same marker (and the next number for
 *    ordered lists); Enter on an empty item removes the marker and exits the
 *    list.
 *
 *  - **Tab indentation** — Tab nests the current list item (two spaces),
 *    Shift-Tab un-nests it, plain lines get a two-space indent at the caret,
 *    and Tab/Shift-Tab over a selection indents / outdents every touched line.
 *
 * Heuristics are character-level on purpose: emphasis markers like `**` are
 * syntactically ambiguous (`a**b` is not bold), so pairing is only attempted
 * at word boundaries — never when the caret touches a word character — and is
 * skipped inside fenced / indented code blocks.
 */

const INDENT_UNIT = '  ';

/* ——— Delimiter pairing ——— */

export type DelimiterAction =
  | { kind: 'insert'; text: string; caret: number }
  | { kind: 'skip' }
  | { kind: 'plain' };

/** Character context right around the caret ('' means "at a boundary"). */
export interface TypeContext {
  ch: '*' | '`';
  /** char immediately before the caret */
  before: string;
  /** char two before the caret ('' when the caret is at a line start) */
  before2: string;
  /** char right after the caret (may be '\n' at a line end) */
  after: string;
  /** true when the caret line only contains whitespace */
  blankLine: boolean;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Letters, digits and CJK count as word chars (emphasis borders them). */
function isWordChar(c: string): boolean {
  return WORD_CHAR.test(c);
}

function isLineEnd(c: string): boolean {
  return c === '' || c === '\n';
}

/**
 * Decides what typing `ch` should do at the given context. Pure so it can be
 * unit-tested without an editor instance.
 */
export function delimiterAction(ctx: TypeContext): DelimiterAction {
  return ctx.ch === '*' ? starAction(ctx) : backtickAction(ctx);
}

/**
 * `*` typing. Rules, in order:
 *  1. A star right after the caret means we are before an (auto-inserted or
 *     hand-typed) closer — skip over it, unless the caret sits between two
 *     fresh opener stars, where the second star turns the pair into bold
 *     (`*|*` → `**|**`, and repeating grows `***|***`).
 *  2. A star right before the caret, after a word, is the second closing star
 *     of bold — type it plainly. After a non-word (fresh opener), the closing
 *     pair is added (`*|` at a line start → `**|**`).
 *  3. Never pair when the caret touches a word char on either side (keeps
 *     `a**b`, closing delimiters and list-like `* ` text intact).
 *  4. Otherwise pair a single emphasis `*|*`. On a blank line the first star
 *     stays plain so `* ` bullets stay typeable; the second star completes a
 *     bold pair instead.
 */
function starAction(ctx: TypeContext): DelimiterAction {
  const { before, before2, after, blankLine } = ctx;

  if (after === '*') {
    if (before !== '' && isWordChar(before)) return { kind: 'skip' };
    if (before === '*') {
      if (before2 !== '' && isWordChar(before2)) return { kind: 'skip' };
      return { kind: 'insert', text: '**', caret: 1 };
    }
    return { kind: 'skip' };
  }

  if (before === '*') {
    // `word**` style: second closing star after a word, or a stray pair.
    if (before2 !== '' && isWordChar(before2)) return { kind: 'plain' };
    // Opening `**` finished at the end of a line: close it and place the
    // caret inside (`*|` → `**|**`).
    if (isLineEnd(after)) return { kind: 'insert', text: '***', caret: 1 };
    return { kind: 'plain' };
  }

  if (before !== '' && isWordChar(before)) return { kind: 'plain' };
  if (after !== '' && isWordChar(after)) return { kind: 'plain' };

  if (isLineEnd(after) && !blankLine) {
    return { kind: 'insert', text: '**', caret: 1 };
  }
  return { kind: 'plain' };
}

/**
 * Backtick typing. The single backtick is a one-character delimiter, so the
 * rules mirror CodeMirror's quote handling:
 *  1. A backtick right after the caret closes the pending span — skip over it.
 *  2. A backtick right before the caret is plain, so a third backtick
 *     completes a ``` fence instead of pairing again.
 *  3. Never pair when the caret touches a word char (`` `code` `` typed
 *     manually, or `word` + backtick mid-text).
 *  4. Otherwise pair `` `|` `` — including on blank lines, where opening a
 *     ``` fence naturally ends up plain after steps 1–2.
 */
function backtickAction(ctx: TypeContext): DelimiterAction {
  const { before, after } = ctx;

  if (after === '`') return { kind: 'skip' };
  if (before === '`') return { kind: 'plain' };
  if (before !== '' && isWordChar(before)) return { kind: 'plain' };
  if (after !== '' && isWordChar(after)) return { kind: 'plain' };

  if (isLineEnd(after)) return { kind: 'insert', text: '``', caret: 1 };
  return { kind: 'plain' };
}

function smartType(view: EditorView, from: number, to: number, text: string): boolean {
  if (text.length !== 1 || from !== to) return false;
  if (text !== '*' && text !== '`') return false;
  // Composition input (IME) must never be reinterpreted.
  if (view.composing) return false;

  const state = view.state;
  if (inBlockCode(state, from)) return false;

  const line = state.doc.lineAt(from);
  const rel = from - line.from;
  const before = rel > 0 ? state.sliceDoc(from - 1, from) : '';
  const before2 = rel > 1 ? state.sliceDoc(from - 2, from - 1) : '';
  const after = state.sliceDoc(from, from + 1);
  const blankLine = line.text.slice(0, rel).trim() === '' && line.text.slice(rel).trim() === '';

  const action = delimiterAction({ ch: text as '*' | '`', before, before2, after, blankLine });
  switch (action.kind) {
    case 'plain':
      return false;
    case 'skip':
      view.dispatch({ selection: { anchor: from + 1 }, scrollIntoView: true });
      return true;
    case 'insert':
      // userEvent 'input' merges this transaction into the same undo step as
      // the delimiter character that just got typed.
      view.dispatch({
        changes: { from, to, insert: action.text },
        selection: { anchor: from + action.caret },
        scrollIntoView: true,
        userEvent: 'input',
      });
      return true;
  }
}

/* ——— List parsing & Enter auto-continuation ——— */

export interface ListLineInfo {
  /** raw marker block incl. indentation & task prefix (what an empty-item Enter strips) */
  prefix: string;
  /** leading whitespace before the marker */
  indent: string;
  /** bullet char ('-', '*', '+') for bullet lists */
  bullet?: string;
  /** numeric value for ordered lists */
  number?: number;
  /** '.' or ')' suffix for ordered lists */
  orderedSuffix?: string;
  /** true when the item carries a checkbox */
  task: boolean;
  /** text after the marker (may be '') */
  content: string;
}

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+)((?:\[[ xX]\]\s+)?)(.*)$/;

/** Parses a markdown list-item line, or returns null when it is not one. */
export function parseListLine(text: string): ListLineInfo | null {
  const m = LIST_RE.exec(text);
  if (!m) return null;
  const marker = m[2]!;
  const task = m[4] !== undefined && m[4]!.length > 0;
  const ordered = /^\d/.test(marker);
  return {
    prefix: m[1]! + m[2]! + m[3]! + (m[4] ?? ''),
    indent: m[1]!,
    bullet: ordered ? undefined : marker,
    number: ordered ? Number.parseInt(marker, 10) : undefined,
    orderedSuffix: ordered ? marker.slice(marker.length - 1) : undefined,
    task,
    content: m[5] ?? '',
  };
}

/** The marker line Enter should produce for the next item. */
export function continuationPrefix(info: ListLineInfo): string {
  const marker = info.bullet !== undefined ? info.bullet : `${(info.number ?? 1) + 1}${info.orderedSuffix ?? '.'}`;
  return info.indent + marker + ' ' + (info.task ? '[ ] ' : '');
}

export interface EnterOutcome {
  changes: ChangeSpec[];
  /** caret position after the transaction */
  anchor: number;
}

/**
 * Pure description of what Enter should do on a list-item line. Returns null
 * when the line is not a list item (or the caret sits inside the marker) and
 * the default newline behaviour should apply.
 *
 * @param lineEnd position right after the line's own break (line.to + 1, or
 *   line.to for the last line of the document)
 */
export function listEnterOutcome(lineFrom: number, lineText: string, pos: number, lineEnd: number): EnterOutcome | null {
  const info = parseListLine(lineText);
  if (!info) return null;
  const rel = pos - lineFrom;
  if (rel < info.prefix.length) return null;

  if (info.content.trim() === '') {
    // Empty item: swallow the whole row (marker + its line break) and leave a
    // single plain row in its place — this exits the list. A trailing line
    // break only needs replacing when the row was not the document's last one.
    const hasOwnBreak = lineEnd > lineFrom + lineText.length;
    return {
      changes: [{ from: lineFrom, to: lineEnd, insert: hasOwnBreak ? '\n' : '' }],
      anchor: lineFrom,
    };
  }
  const prefix = continuationPrefix(info);
  return {
    changes: [{ from: pos, to: pos, insert: '\n' + prefix }],
    anchor: pos + 1 + prefix.length,
  };
}

const smartEnter: Command = (view) => {
  const state = view.state;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const pos = sel.from;
  if (inCode(state, pos)) return false;

  const line = state.doc.lineAt(pos);
  const lineEnd = line.to + (line.to < state.doc.length ? 1 : 0);
  const outcome = listEnterOutcome(line.from, line.text, pos, lineEnd);
  if (!outcome) return false;

  view.dispatch({ changes: outcome.changes, selection: { anchor: outcome.anchor }, scrollIntoView: true });
  return true;
};

/* ——— Tab / Shift-Tab indentation ——— */

/** Number of leading spaces to strip from `line` when outdenting (0..unit). */
function outdentAmount(line: string): number {
  const m = /^[ ]+/.exec(line);
  return m ? Math.min(m[0].length, INDENT_UNIT.length) : 0;
}

function runTab(view: EditorView, shift: boolean): boolean {
  const state = view.state;
  const sel = state.selection.main;
  if (state.selection.ranges.length > 1) return false;
  const { from, to } = sel;

  // Indent / outdent every line touched by a selection.
  if (from !== to) {
    const changes: ChangeSpec[] = [];
    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);
    for (let n = startLine.number; n <= endLine.number; n++) {
      const l = state.doc.line(n);
      if (shift) {
        const cut = outdentAmount(l.text);
        if (cut > 0) changes.push({ from: l.from, to: l.from + cut, insert: '' });
      } else {
        changes.push({ from: l.from, to: l.from, insert: INDENT_UNIT });
      }
    }
    if (changes.length > 0) view.dispatch({ changes, scrollIntoView: true });
    return true;
  }

  const line = state.doc.lineAt(from);
  const info = inCode(state, from) ? null : parseListLine(line.text);

  // On a list line Tab nests the whole item; Shift-Tab un-nests it.
  if (info) {
    if (shift) {
      const cut = outdentAmount(line.text);
      if (cut > 0) view.dispatch({ changes: { from: line.from, to: line.from + cut, insert: '' } });
      return true;
    }
    view.dispatch({ changes: { from: line.from, to: line.from, insert: INDENT_UNIT }, scrollIntoView: true });
    return true;
  }

  if (shift) {
    // Outdent the leading whitespace of the current line when it has any;
    // otherwise keep focus (no-op) instead of letting Tab blur the editor.
    const cut = outdentAmount(line.text);
    if (cut > 0) view.dispatch({ changes: { from: line.from, to: line.from + cut, insert: '' } });
    return true;
  }

  // Plain line: insert an indent unit at the caret.
  view.dispatch({
    changes: { from, to: from, insert: INDENT_UNIT },
    selection: { anchor: from + INDENT_UNIT.length },
    scrollIntoView: true,
  });
  return true;
}

const smartTab: Command = (view) => runTab(view, false);
const smartShiftTab: Command = (view) => runTab(view, true);

/* ——— Code context detection ——— */

/** Walks from `node` to the root looking for a matching node name. */
function hasAncestorNamed(node: SyntaxNode, ...names: string[]): boolean {
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (names.includes(cur.name)) return true;
    cur = cur.parent as SyntaxNode | null;
  }
  return false;
}

/**
 * True when `pos` sits inside a fenced (```) or indented (4 spaces) code
 * block. Inline code is deliberately excluded: the typing heuristics handle
 * closing a `` ` `` span by skipping over the pending backtick, which a code
 * node at that position would otherwise disable.
 */
function inBlockCode(state: EditorState, pos: number): boolean {
  return hasAncestorNamed(syntaxTree(state).resolveInner(pos, -1), 'FencedCode', 'CodeBlock');
}

/** True when `pos` sits inside any code (inline, fenced or indented). */
function inCode(state: EditorState, pos: number): boolean {
  return hasAncestorNamed(syntaxTree(state).resolveInner(pos, -1), 'FencedCode', 'CodeBlock', 'InlineCode');
}

/**
 * The one extension value used by the editor. Built here (below every handler
 * it references) so module load order stays simple; static identity keeps
 * CodeMirror from rebuilding facets on re-render.
 */
export const markdownSmartInput: Extension = Prec.high([
  EditorView.inputHandler.of(smartType),
  keymap.of([
    { key: 'Enter', run: smartEnter },
    { key: 'Tab', run: smartTab },
    { key: 'Shift-Tab', run: smartShiftTab },
  ]),
]);
