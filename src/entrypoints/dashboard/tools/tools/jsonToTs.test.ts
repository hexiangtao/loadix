import { describe, expect, it } from 'vitest';
import { jsonToTs } from './jsonToTs';

describe('jsonToTs', () => {
  it('generates an interface for a flat object', () => {
    const out = jsonToTs({ id: 1, name: 'loadix', active: true });
    expect(out).toContain('export interface Root {');
    expect(out).toContain('id: number;');
    expect(out).toContain('name: string;');
    expect(out).toContain('active: boolean;');
  });

  it('nests interfaces for nested objects', () => {
    const out = jsonToTs({ user: { id: 1, tags: ['a', 'b'] } });
    expect(out).toContain('export interface User {');
    expect(out).toContain('tags: string[];');
    expect(out).toContain('id: number;');
  });

  it('merges array item shapes into one optional-friendly interface', () => {
    const out = jsonToTs({
      rows: [
        { id: 1, name: 'a' },
        { id: 2, extra: 'x' },
      ],
    });
    expect(out).toContain('rows: Row[];');
    // union-free single interface with both keys
    expect(out).toContain('name: string;');
    expect(out).toContain('extra: string;');
  });

  it('handles empty arrays and nulls', () => {
    const out = jsonToTs({ empty: [], nothing: null });
    expect(out).toContain('empty: unknown[];');
    expect(out).toContain('nothing: null;');
  });

  it('produces a type alias for scalar roots', () => {
    expect(jsonToTs('hello')).toBe('export type Root = string;');
    expect(jsonToTs(42, { rootName: 'answer' })).toBe('export type Answer = number;');
  });

  it('quotes non-identifier keys', () => {
    const out = jsonToTs({ 'weird-key': 1 });
    expect(out).toContain('"weird-key": number;');
  });

  it('supports type-alias style', () => {
    const out = jsonToTs({ a: 1 }, { style: 'type' });
    expect(out).toContain('export type Root = {');
  });
});
