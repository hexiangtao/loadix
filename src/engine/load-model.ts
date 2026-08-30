/**
 * Load model primitives: concurrency shaping + rate pacing.
 *
 * The key architectural idea: **concurrency and RPS are independent**.
 *  - Concurrency = number of requests in flight at a given moment.
 *  - RPS = requests started per second.
 *
 * A load model answers "how many requests should be in flight at time t?",
 * while a rate limiter answers "when exactly may the next request start?".
 */

export type LoadModelKind = 'constant' | 'ramp';

export interface LoadModel {
  kind: LoadModelKind;
  /** Peak concurrency (virtual users). */
  users: number;
  /** Total duration in seconds. */
  duration: number;
  /** Ramp-up seconds (used when kind === 'ramp'). */
  ramp: number;
  /** Target RPS; 0 = unlimited (bounded only by concurrency). */
  rps: number;
}

/**
 * Concurrency target at a given elapsed second.
 *  - constant: `users` for the whole run.
 *  - ramp: linear from 1 → `users` over `ramp` seconds, then hold.
 */
export function targetConcurrency(model: LoadModel, elapsedSec: number): number {
  const users = Math.max(1, model.users);
  if (model.kind === 'constant') return users;
  // ramp
  if (elapsedSec <= 0) return 1;
  if (elapsedSec >= model.ramp) return users;
  const progress = elapsedSec / Math.max(1, model.ramp);
  return Math.max(1, Math.round(1 + (users - 1) * progress));
}

/**
 * Token bucket rate limiter. Refills `rps` tokens per second, each request
 * consumes one token. When `rps` is 0, requests are not rate-limited.
 *
 * The bucket smooths bursts while enforcing a long-term average of `rps`.
 */
export class TokenBucket {
  private tokens = 0;
  private lastRefill: number;
  private readonly capacity: number;

  constructor(private readonly rps: number, now: number) {
    this.capacity = Math.max(1, rps);
    this.lastRefill = now;
    this.tokens = this.capacity;
  }

  /** Try to take a token. Returns true if a request may start now. */
  take(now: number): boolean {
    if (this.rps <= 0) return true;
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Milliseconds to wait until the next token is available (0 = now). */
  waitForToken(now: number): number {
    if (this.rps <= 0) return 0;
    this.refill(now);
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.rps) * 1000);
  }

  private refill(now: number): void {
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rps);
    this.lastRefill = now;
  }
}
