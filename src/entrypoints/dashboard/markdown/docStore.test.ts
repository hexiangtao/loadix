import { describe, expect, it } from 'vitest';
import { docDisplayTitle, firstHeading, uid } from './docStore';

describe('firstHeading', () => {
  it('extracts an ATX h1 at the start of the document', () => {
    expect(firstHeading('# My Title\n\nbody')).toBe('My Title');
  });

  it('finds the first heading even when preceded by other lines', () => {
    expect(firstHeading('intro text\n\n## Sub\n# The Real One\n')).toBe('The Real One');
  });

  it('handles any heading level for the auto-title', () => {
    expect(firstHeading('### Deep\nbody')).toBe('Deep');
  });

  it('trims surrounding whitespace', () => {
    expect(firstHeading('#  Spaced Title  \n')).toBe('Spaced Title');
  });

  it('strips inline emphasis/code markers from the extracted title', () => {
    expect(firstHeading('# **Bold** Title\n')).toBe('Bold Title');
    expect(firstHeading('## `code` & ~~gone~~\n')).toBe('code & gone');
  });

  it('returns empty for documents without a heading', () => {
    expect(firstHeading('just a paragraph')).toBe('');
    expect(firstHeading('')).toBe('');
    expect(firstHeading('#no space is not a heading\n')).toBe('');
  });
});

describe('docDisplayTitle', () => {
  it('prefers the manual title', () => {
    expect(docDisplayTitle({ title: 'Manual', content: '# Auto' }, 'Untitled')).toBe('Manual');
  });

  it('falls back to the first heading', () => {
    expect(docDisplayTitle({ title: '', content: '# Auto Title' }, 'Untitled')).toBe('Auto Title');
  });

  it('falls back to the supplied fallback when nothing exists', () => {
    expect(docDisplayTitle({ title: '', content: 'no headings here' }, 'Untitled')).toBe('Untitled');
  });
});

describe('uid', () => {
  it('produces non-empty unique ids', () => {
    const a = uid();
    const b = uid();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});