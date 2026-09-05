import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  continuationPrefix,
  delimiterAction,
  listEnterOutcome,
  parseListLine,
  type TypeContext,
} from './markdownSmartInput';

/* ——— delimiterAction: backticks ——— */

function backtick(over: Partial<TypeContext>): TypeContext {
  return { ch: '`', before: '', before2: '', after: '', blankLine: true, ...over };
}

describe('delimiterAction — backtick', () => {
  it('pairs an inline-code opener at a line end', () => {
    expect(delimiterAction(backtick({ before: ' ', after: '\n', blankLine: false }))).toEqual({
      kind: 'insert',
      text: '``',
      caret: 1,
    });
  });

  it('skips over the pending closer when typing the closing backtick', () => {
    expect(delimiterAction(backtick({ before: 'e', after: '`', blankLine: false }))).toEqual({
      kind: 'skip',
    });
  });

  it('types a third backtick plainly (completing a fence)', () => {
    expect(delimiterAction(backtick({ before: '`', after: '\n' }))).toEqual({ kind: 'plain' });
  });

  it('types a closing backtick plainly after content when no closer is pending', () => {
    expect(delimiterAction(backtick({ before: 'e', after: '', blankLine: false }))).toEqual({
      kind: 'plain',
    });
  });

  it('does not wrap text that already follows the caret', () => {
    expect(delimiterAction(backtick({ before: ' ', after: 'x', blankLine: false }))).toEqual({
      kind: 'plain',
    });
  });

  it('pairs even on a blank line (fences resolve via skip + plain)', () => {
    expect(delimiterAction(backtick({ before: '', after: '\n', blankLine: true }))).toEqual({
      kind: 'insert',
      text: '``',
      caret: 1,
    });
  });
});

/* ——— delimiterAction: asterisks ——— */

function star(over: Partial<TypeContext>): TypeContext {
  return { ch: '*', before: '', before2: '', after: '', blankLine: true, ...over };
}

describe('delimiterAction — asterisk', () => {
  it('pairs a single emphasis opener at the end of content', () => {
    expect(delimiterAction(star({ before: ' ', after: '\n', blankLine: false }))).toEqual({
      kind: 'insert',
      text: '**',
      caret: 1,
    });
  });

  it('turns a typed second star into a bold pair with the caret inside', () => {
    expect(delimiterAction(star({ before: '*', before2: ' ', after: '*', blankLine: false }))).toEqual({
      kind: 'insert',
      text: '**',
      caret: 1,
    });
  });

  it('grows ** into *** when a third star is typed inside the pair', () => {
    expect(delimiterAction(star({ before: '*', before2: '*', after: '*', blankLine: false }))).toEqual({
      kind: 'insert',
      text: '**',
      caret: 1,
    });
  });

  it('keeps a blank-line opener plain so `* ` bullets and `***` rules stay typeable', () => {
    expect(delimiterAction(star({ before: '', after: '\n', blankLine: true }))).toEqual({ kind: 'plain' });
  });

  it('closes a bold opener started on a blank line', () => {
    expect(delimiterAction(star({ before: '*', before2: '', after: '\n', blankLine: true }))).toEqual({
      kind: 'insert',
      text: '***',
      caret: 1,
    });
  });

  it('skips over the closer when the caret is right before it', () => {
    expect(delimiterAction(star({ before: 'd', after: '*', blankLine: false }))).toEqual({ kind: 'skip' });
  });

  it('skips the second closer star of bold', () => {
    expect(delimiterAction(star({ before: '*', before2: 'd', after: '*', blankLine: false }))).toEqual({
      kind: 'skip',
    });
  });

  it('types the second closing star of bold plainly', () => {
    expect(delimiterAction(star({ before: '*', before2: 'd', after: '', blankLine: false }))).toEqual({
      kind: 'plain',
    });
  });

  it('never pairs next to a word character (a**b stays intact)', () => {
    expect(delimiterAction(star({ before: 'a', after: '', blankLine: false }))).toEqual({ kind: 'plain' });
    expect(delimiterAction(star({ before: ' ', after: 'b', blankLine: false }))).toEqual({ kind: 'plain' });
  });

  it('treats CJK characters as word characters', () => {
    expect(delimiterAction(star({ before: '字', after: '', blankLine: false }))).toEqual({ kind: 'plain' });
  });
});

/* ——— list line parsing ——— */

describe('parseListLine', () => {
  it('parses bullet items', () => {
    expect(parseListLine('- item')).toMatchObject({ prefix: '- ', indent: '', bullet: '-', task: false, content: 'item' });
    expect(parseListLine('* em')).toMatchObject({ prefix: '* ', bullet: '*', content: 'em' });
    expect(parseListLine('+ plus')).toMatchObject({ bullet: '+', content: 'plus' });
  });

  it('keeps indentation (nesting)', () => {
    expect(parseListLine('  - nested')).toMatchObject({ prefix: '  - ', indent: '  ', content: 'nested' });
  });

  it('parses ordered items with the next number available', () => {
    expect(parseListLine('3. third')).toMatchObject({
      prefix: '3. ',
      indent: '',
      number: 3,
      orderedSuffix: '.',
      content: 'third',
    });
    expect(parseListLine('42) answer')).toMatchObject({ number: 42, orderedSuffix: ')' });
  });

  it('parses task items', () => {
    expect(parseListLine('- [ ] todo')).toMatchObject({ prefix: '- [ ] ', task: true, content: 'todo' });
    expect(parseListLine('- [x] done')).toMatchObject({ task: true, content: 'done' });
    expect(parseListLine('  - [X] done')).toMatchObject({ prefix: '  - [X] ', indent: '  ' });
  });

  it('returns null for non-list lines', () => {
    expect(parseListLine('plain text')).toBeNull();
    expect(parseListLine('-item')).toBeNull(); // missing space after marker
    expect(parseListLine('1.item')).toBeNull();
    expect(parseListLine('# heading')).toBeNull();
    expect(parseListLine('')).toBeNull();
  });
});

describe('continuationPrefix', () => {
  it('repeats the bullet marker', () => {
    expect(continuationPrefix(parseListLine('- item')!)).toBe('- ');
    expect(continuationPrefix(parseListLine('* em')!)).toBe('* ');
    expect(continuationPrefix(parseListLine('+ plus')!)).toBe('+ ');
  });

  it('keeps the indentation of nested items', () => {
    expect(continuationPrefix(parseListLine('    - nested')!)).toBe('    - ');
  });

  it('increments ordered numbers and keeps the suffix', () => {
    expect(continuationPrefix(parseListLine('3. third')!)).toBe('4. ');
    expect(continuationPrefix(parseListLine('  12) twelve')!)).toBe('  13) ');
  });

  it('continues task items unchecked', () => {
    expect(continuationPrefix(parseListLine('- [x] done')!)).toBe('- [ ] ');
    expect(continuationPrefix(parseListLine('- [ ] todo')!)).toBe('- [ ] ');
    expect(continuationPrefix(parseListLine('  - [ ] todo')!)).toBe('  - [ ] ');
  });
});

/* ——— Enter behaviour, applied through a real EditorState ——— */

function applyOutcome(doc: string, pos: number, lineFrom: number, lineText: string, lineEnd?: number) {
  const outcome = listEnterOutcome(lineFrom, lineText, pos, lineEnd ?? lineFrom + lineText.length + 1);
  expect(outcome).not.toBeNull();
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  const next = state.update({
    changes: outcome!.changes,
    selection: { anchor: outcome!.anchor },
  });
  return { doc: next.state.doc.toString(), pos: next.state.selection.main.anchor };
}

describe('listEnterOutcome', () => {
  it('continues a bullet item', () => {
    const r = applyOutcome('- alpha\n- beta', 7, 0, '- alpha');
    expect(r.doc).toBe('- alpha\n- \n- beta');
    expect(r.pos).toBe(10); // at the end of the fresh '- ' marker
  });

  it('continues nested bullets at the same indentation', () => {
    const r = applyOutcome('  - a\nnext', 5, 0, '  - a');
    expect(r.doc).toBe('  - a\n  - \nnext');
  });

  it('increments ordered items', () => {
    const r = applyOutcome('1. a\n2. b', 4, 0, '1. a');
    expect(r.doc).toBe('1. a\n2. \n2. b');
  });

  it('continues task items unchecked', () => {
    const r = applyOutcome('- [x] done\nnext', 10, 0, '- [x] done');
    expect(r.doc).toBe('- [x] done\n- [ ] \nnext');
  });

  it('exits the list when Enter is pressed on an empty item', () => {
    const r = applyOutcome('- alpha\n- \nnext', 10, 8, '- ', 11);
    expect(r.doc).toBe('- alpha\n\nnext');
    expect(r.pos).toBe(8);
  });

  it('exits a nested empty item and clears its marker', () => {
    const r = applyOutcome('- alpha\n  - \nnext', 12, 8, '  - ', 13);
    expect(r.doc).toBe('- alpha\n\nnext');
    expect(r.pos).toBe(8);
  });

  it('exits an empty last item with no trailing newline', () => {
    const r = applyOutcome('- alpha\n- ', 10, 8, '- ', 10);
    expect(r.doc).toBe('- alpha\n');
    expect(r.pos).toBe(8);
  });

  it('splits content after the caret onto a continued item', () => {
    const r = applyOutcome('- foo bar', 5, 0, '- foo bar');
    expect(r.doc).toBe('- foo\n-  bar');
  });

  it('returns null for plain lines', () => {
    expect(listEnterOutcome(0, 'plain text', 10, 10)).toBeNull();
  });

  it('returns null when the caret sits inside the marker', () => {
    expect(listEnterOutcome(0, '- item', 1, 1)).toBeNull();
  });
});

/* ——— Full typing flows (dispatch semantics mirror the editor handler) ——— */

function typeFlow(initial: string, keys: string[]): { doc: string; pos: number } {
  let doc = initial;
  let pos = doc.length;
  for (const key of keys) {
    const isDelimiter = key.length === 1 && (key === '*' || key === '`');
    if (isDelimiter) {
      const line = doc.slice(0, pos).split('\n').pop() ?? '';
      const next = doc.indexOf('\n', pos);
      const restLine = next === -1 ? doc.slice(pos) : doc.slice(pos, next);
      const rel = line.length;
      const before = rel > 0 ? doc[pos - 1]! : '';
      const before2 = rel > 1 ? doc[pos - 2]! : '';
      const after = pos < doc.length ? doc[pos]! : '';
      const blankLine = line.trim() === '' && restLine.trim() === '';
      const action = delimiterAction({ ch: key as '*' | '`', before, before2, after, blankLine });
      if (action.kind === 'insert') {
        doc = doc.slice(0, pos) + action.text + doc.slice(pos);
        pos += action.caret;
      } else if (action.kind === 'skip') {
        pos += 1;
      } else {
        doc = doc.slice(0, pos) + key + doc.slice(pos);
        pos += 1;
      }
      continue;
    }
    // Ordinary text (single chars or pasted chunks) inserts as-is.
    doc = doc.slice(0, pos) + key + doc.slice(pos);
    pos += key.length;
  }
  return { doc, pos };
}

describe('typing flows', () => {
  it('types inline code with an auto-closing backtick', () => {
    const r = typeFlow('use ', ['`', 'code', '`']);
    expect(r.doc).toBe('use `code`');
    expect(r.pos).toBe(r.doc.length);
  });

  it('types a ``` fence plainly', () => {
    const r = typeFlow('', ['`', '`', '`']);
    expect(r.doc).toBe('```');
  });

  it('types bold from scratch with pairing and skips', () => {
    const r = typeFlow('text ', ['*', '*', 'bold', '*', '*']);
    expect(r.doc).toBe('text **bold**');
    expect(r.pos).toBe(r.doc.length);
  });

  it('types bold CJK content from a blank line', () => {
    const r = typeFlow('', ['*', '*', '加粗', '*', '*']);
    expect(r.doc).toBe('**加粗**');
    expect(r.pos).toBe(r.doc.length);
  });

  it('leaves a**b exponent-style text alone', () => {
    const r = typeFlow('', ['a', '*', '*', 'b']);
    expect(r.doc).toBe('a**b');
  });
});
