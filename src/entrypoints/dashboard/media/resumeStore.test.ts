import { describe, expect, it } from 'vitest';
import { ResumeStore, type ResumeRecord } from './resumeStore';

const record = (bytesWritten: number, signature = 'sig', payload = 'sink'): ResumeRecord<string> => ({
  bytesWritten,
  unitsDone: bytesWritten,
  signature,
  payload,
  updatedAt: Date.now(),
});

describe('ResumeStore', () => {
  it('holds and returns a partial by key', () => {
    const store = new ResumeStore<string>();
    store.put('a', record(100));
    expect(store.size).toBe(1);
    expect(store.get('a')?.bytesWritten).toBe(100);
    expect(store.get('missing')).toBeUndefined();
  });

  it('replacing a key keeps the newest partial and does not grow', () => {
    const store = new ResumeStore<string>();
    store.put('a', record(100));
    store.put('a', record(250));
    expect(store.size).toBe(1);
    expect(store.get('a')?.bytesWritten).toBe(250);
  });

  it('evicts the least-recently written partial past the cap', () => {
    const store = new ResumeStore<string>(2);
    expect(store.put('a', record(1))).toEqual([]);
    store.put('b', record(2));
    const evicted = store.put('c', record(3));
    expect(evicted.map((r) => r.payload)).toEqual(['sink']);
    expect(store.has('a')).toBe(false);
    expect(store.has('b')).toBe(true);
    expect(store.has('c')).toBe(true);
    expect(store.size).toBe(2);
  });

  it('re-writing a key refreshes its place in the eviction order', () => {
    const store = new ResumeStore<string>(2);
    store.put('a', record(1));
    store.put('b', record(2));
    // 'a' is touched, so 'b' becomes the oldest and goes first.
    store.put('a', record(9));
    store.put('c', record(3));
    expect(store.has('a')).toBe(true);
    expect(store.has('b')).toBe(false);
  });

  it('drop hands the partial back so the caller can release the sink', () => {
    const store = new ResumeStore<string>();
    store.put('a', record(7, 'sig', 'the-sink'));
    expect(store.drop('a')?.payload).toBe('the-sink');
    expect(store.drop('a')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('drain empties the store and returns everything held', () => {
    const store = new ResumeStore<string>();
    store.put('a', record(1, 'sig', 'sink-a'));
    store.put('b', record(2, 'sig', 'sink-b'));
    expect(store.drain().map((r) => r.payload)).toEqual(['sink-a', 'sink-b']);
    expect(store.size).toBe(0);
    expect(store.drain()).toEqual([]);
  });

  it('keeps the signature with the partial so a stale one can be detected', () => {
    const store = new ResumeStore<string>();
    store.put('a', record(10, 'v1'));
    // A rotated token / different ladder produces a different signature, and
    // the engine must not append to the old bytes (`SinkLease.ensureSignature`).
    expect(store.get('a')?.signature).toBe('v1');
  });
});
