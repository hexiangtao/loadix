import { describe, expect, it } from 'vitest';
import { assertionsPass, interpolate, percentile, rampUpDelay, RpsScheduler } from './core';

describe('interpolate', () => {
  it('replaces known variables', () => {
    expect(interpolate('/users/{{id}}?q={{name}}', { id: '42', name: 'tom' })).toBe('/users/42?q=tom');
  });
  it('leaves unknown variables empty', () => {
    expect(interpolate('{{missing}}', {})).toBe('');
  });
  it('tolerates whitespace', () => {
    expect(interpolate('{{  token  }}', { token: 'abc' })).toBe('abc');
  });
});

describe('percentile', () => {
  it('returns 0 for empty input', () => {
    expect(percentile([], 95)).toBe(0);
  });
  it('computes p95', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(data, 95)).toBe(95);
  });
});

describe('assertionsPass', () => {
  const base = { status: 200, ms: 100, body: 'hello world', ok: true, error: '' };
  it('passes with no assertions', () => {
    expect(assertionsPass(base, [])).toBe(true);
  });
  it('fails on status mismatch', () => {
    expect(assertionsPass(base, [{ type: 'status', value: '404' }])).toBe(false);
  });
  it('fails when latency exceeds limit', () => {
    expect(assertionsPass(base, [{ type: 'latency', value: '50' }])).toBe(false);
  });
  it('fails when body does not contain text', () => {
    expect(assertionsPass(base, [{ type: 'contains', value: 'goodbye' }])).toBe(false);
  });
  it('passes when all assertions hold', () => {
    expect(
      assertionsPass(base, [
        { type: 'status', value: '200' },
        { type: 'latency', value: '500' },
        { type: 'contains', value: 'world' },
      ]),
    ).toBe(true);
  });
});

describe('rampUpDelay', () => {
  it('returns 0 when ramp disabled', () => {
    expect(rampUpDelay(5, 10, 0)).toBe(0);
  });
  it('spreads users evenly', () => {
    expect(rampUpDelay(0, 10, 5)).toBe(0);
    expect(rampUpDelay(5, 10, 5)).toBe(2500);
  });
});

describe('RpsScheduler', () => {
  it('launches immediately when rps disabled', () => {
    const s = new RpsScheduler(0, 0);
    expect(s.acquire(1000)).toBe(0);
  });
  it('paces launches at the target interval', () => {
    const s = new RpsScheduler(10, 0); // 100ms interval
    expect(s.acquire(0)).toBe(0);
    expect(s.acquire(0)).toBe(100);
    expect(s.acquire(0)).toBe(200);
  });
  it('does not fall behind when caller is late', () => {
    const s = new RpsScheduler(10, 0);
    s.acquire(0);
    expect(s.acquire(500)).toBe(0); // late caller launches now
    expect(s.acquire(500)).toBe(100);
  });
});
