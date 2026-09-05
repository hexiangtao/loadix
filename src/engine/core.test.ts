import { describe, expect, it } from 'vitest';
import { assertionsPass, interpolate, percentile } from './core';
import { TokenBucket, evaluateAutoStop, targetConcurrency } from './load-model';
import { normaliseError } from './metrics';

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

describe('targetConcurrency', () => {
  const base = {
    kind: 'constant' as const,
    users: 10,
    duration: 30,
    ramp: 0,
    rps: 0,
    stepUsers: 0,
    stepDuration: 0,
    spikeUsers: 0,
    spikeDuration: 0,
  };

  it('constant model holds users for whole run', () => {
    expect(targetConcurrency(base, 0)).toBe(10);
    expect(targetConcurrency(base, 15)).toBe(10);
    expect(targetConcurrency(base, 29)).toBe(10);
  });

  it('ramp model starts at 1 and climbs to users', () => {
    const ramp = { ...base, kind: 'ramp' as const, ramp: 10 };
    expect(targetConcurrency(ramp, 0)).toBe(1);
    expect(targetConcurrency(ramp, 5)).toBeGreaterThan(1);
    expect(targetConcurrency(ramp, 5)).toBeLessThan(10);
    expect(targetConcurrency(ramp, 10)).toBe(10);
    expect(targetConcurrency(ramp, 20)).toBe(10); // holds after ramp
  });

  it('step model increases by stepUsers every stepDuration', () => {
    const step = { ...base, kind: 'step' as const, stepUsers: 3, stepDuration: 5 };
    expect(targetConcurrency(step, 0)).toBe(1);
    expect(targetConcurrency(step, 4)).toBe(1);
    expect(targetConcurrency(step, 5)).toBe(4); // 1 + 3
    expect(targetConcurrency(step, 10)).toBe(7); // 1 + 3 + 3
    expect(targetConcurrency(step, 100)).toBe(10); // capped at users
  });

  it('spike model bursts in the middle then returns to users', () => {
    const spike = { ...base, kind: 'spike' as const, spikeUsers: 50, spikeDuration: 10, duration: 30 };
    expect(targetConcurrency(spike, 0)).toBe(10); // before spike
    expect(targetConcurrency(spike, 10)).toBe(50); // mid = 30/2 - 10/2 = 10
    expect(targetConcurrency(spike, 15)).toBe(50); // inside spike
    expect(targetConcurrency(spike, 20)).toBe(10); // after spike
  });

  it('soak model holds users for whole run', () => {
    const soak = { ...base, kind: 'soak' as const };
    expect(targetConcurrency(soak, 0)).toBe(10);
    expect(targetConcurrency(soak, 500)).toBe(10);
  });

  it('clamps users to at least 1', () => {
    expect(targetConcurrency({ ...base, users: 0 }, 0)).toBe(1);
  });
});

describe('TokenBucket', () => {
  it('allows unlimited when rps is 0', () => {
    const b = new TokenBucket(0, 0);
    expect(b.take(1000)).toBe(true);
    expect(b.take(1000)).toBe(true);
  });

  it('limits to roughly rps tokens per second', () => {
    const b = new TokenBucket(10, 0);
    let taken = 0;
    // First token is immediately available (bucket pre-filled).
    if (b.take(0)) taken++;
    // 1 second later, ~10 more tokens available.
    if (b.take(1000)) taken++;
    // Drain remaining ~9 tokens within the same second.
    for (let i = 0; i < 20; i++) if (b.take(1000)) taken++;
    expect(taken).toBe(11);
  });

  it('waitForToken returns 0 when token available, positive otherwise', () => {
    const b = new TokenBucket(1, 0); // 1 token/sec, pre-filled with 1
    expect(b.waitForToken(0)).toBe(0);
    b.take(0); // consume the pre-filled token
    expect(b.waitForToken(0)).toBeGreaterThan(0);
  });
});

describe('evaluateAutoStop', () => {
  it('returns null when no guards set', () => {
    expect(evaluateAutoStop({ maxErrorRate: 0, maxP95: 0 }, { errorRate: 50, p95: 5000, requests: 100 })).toBeNull();
  });

  it('returns null before minimum sample size', () => {
    expect(evaluateAutoStop({ maxErrorRate: 5, maxP95: 0 }, { errorRate: 50, p95: 0, requests: 5 })).toBeNull();
  });

  it('triggers errorRate when exceeded', () => {
    expect(evaluateAutoStop({ maxErrorRate: 10, maxP95: 0 }, { errorRate: 15, p95: 0, requests: 100 })).toBe('errorRate');
  });

  it('triggers p95 when exceeded', () => {
    expect(evaluateAutoStop({ maxErrorRate: 0, maxP95: 500 }, { errorRate: 0, p95: 800, requests: 100 })).toBe('p95');
  });

  it('does not trigger when within limits', () => {
    expect(evaluateAutoStop({ maxErrorRate: 10, maxP95: 500 }, { errorRate: 3, p95: 400, requests: 100 })).toBeNull();
  });
});

describe('normaliseError', () => {
  it('strips V8-style stack frames', () => {
    const raw = 'TypeError: Failed to fetch\n    at fetch (app.js:1:42)\n    at runOne (runner.ts:87:5)';
    expect(normaliseError(raw)).toBe('TypeError: Failed to fetch');
  });

  it('collapses URLs and IPs into placeholders', () => {
    const raw = 'CORS error contacting https://api.example.com:8443/v1/x from 10.0.0.7';
    const out = normaliseError(raw);
    expect(out).toContain('<url>');
    expect(out).toContain('<ip>');
    expect(out).not.toContain('api.example.com');
  });

  it('passes through short messages unchanged', () => {
    expect(normaliseError('TIMEOUT')).toBe('TIMEOUT');
    // Trailing punctuation is intentionally stripped (so identical errors
    // with/without final punctuation collapse together).
    expect(normaliseError('NetworkError when attempting to fetch resource.')).toBe(
      'NetworkError when attempting to fetch resource',
    );
  });

  it('trims trailing punctuation', () => {
    expect(normaliseError('Something happened.')).toBe('Something happened');
    expect(normaliseError('Something happened.。。')).toBe('Something happened');
  });

  it('caps very long messages with ellipsis', () => {
    const raw = 'x'.repeat(500);
    const out = normaliseError(raw);
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out.endsWith('…')).toBe(true);
  });

  it('falls back to a sentinel when the input is blank', () => {
    // Whitespace-only or empty strings normalise to '' after trim, so we
    // surface a constant label rather than an empty bucket.
    expect(normaliseError('   ')).toBe('Unknown error');
    expect(normaliseError('')).toBe('Unknown error');
  });
});
