import { describe, expect, it } from 'vitest';
import { firstJsonPath, queryJsonPath } from './jsonpath';

const SAMPLE = {
  store: {
    books: [
      { title: 'A', price: 10, tags: ['x', 'y'] },
      { title: 'B', price: 20, tags: ['z'] },
    ],
    open: true,
  },
  meta: { count: 2, nested: { deep: { value: 42 } } },
};

describe('queryJsonPath', () => {
  it('resolves root, dotted and bracketed keys', () => {
    expect(firstJsonPath(SAMPLE, '$')).toBe(SAMPLE);
    expect(firstJsonPath(SAMPLE, '$.store.open')).toBe(true);
    expect(firstJsonPath(SAMPLE, "$['store']['open']")).toBe(true);
    expect(firstJsonPath(SAMPLE, '$["store"]["open"]')).toBe(true);
  });

  it('supports indexes and index lists', () => {
    expect(firstJsonPath(SAMPLE, '$.store.books[0].title')).toBe('A');
    expect(queryJsonPath(SAMPLE, '$.store.books[0,1].price')).toEqual([10, 20]);
  });

  it('supports wildcards on arrays and objects', () => {
    expect(queryJsonPath(SAMPLE, '$.store.books[*].title')).toEqual(['A', 'B']);
    expect(queryJsonPath(SAMPLE, '$.store.*').length).toBe(2);
  });

  it('maps property access across array elements', () => {
    expect(queryJsonPath(SAMPLE, '$.store.books.title')).toEqual(['A', 'B']);
  });

  it('supports recursive descent', () => {
    expect(firstJsonPath(SAMPLE, '$..value')).toBe(42);
    expect(queryJsonPath(SAMPLE, '$..price')).toEqual([10, 20]);
  });

  it('returns [] for missing paths instead of throwing', () => {
    expect(queryJsonPath(SAMPLE, '$.nope')).toEqual([]);
    expect(queryJsonPath(SAMPLE, '$.store.books[9]')).toEqual([]);
    expect(queryJsonPath(SAMPLE, '')).toEqual([]);
    expect(queryJsonPath(SAMPLE, '$..')).toEqual([]);
    expect(queryJsonPath(SAMPLE, 'not valid!!')).toEqual([]);
  });

  it('skips null/undefined holes', () => {
    expect(queryJsonPath({ a: null, b: undefined, c: 1 }, '$.a')).toEqual([]);
    expect(queryJsonPath({ a: null, b: undefined, c: 1 }, '$.*')).toEqual([1]);
  });
});