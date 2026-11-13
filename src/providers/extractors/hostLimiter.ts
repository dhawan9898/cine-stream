// hostLimiter.ts - One request budget per host, shared by every provider.
//
// Several providers (and a prefetch running beside the user's own Play) can hit the same host at once.
// Each host gets a token bucket; a 429 closes the host for its Retry-After instead of every provider
// rediscovering it. Background lookups only spend from a well-filled bucket, so a Play never queues
// behind them. A closed or busy host fails fast (RateLimitedError): the race moves to the next provider
// instead of waiting.

export class RateLimitedError extends Error {
  readonly host: string;
  readonly reason: 'closed' | 'busy';
  constructor(host: string, reason: 'closed' | 'busy') {
    super(`HTTP 429 rate limited (${reason}): ${host}`);
    this.name = 'RateLimitedError';
    this.host = host;
    this.reason = reason;
  }
}

interface Bucket { tokens: number; last: number; rps: number; burst: number; closedUntil: number }

export interface HostLimit { rps: number; burst: number }

const DEFAULT_LIMIT: HostLimit = { rps: 16, burst: 32 };
// A 429 without Retry-After closes the host this long.
const DEFAULT_PENALTY_MS = 60_000;
const MAX_PENALTY_MS = 10 * 60_000;
// Longest a foreground request waits for a token before giving up on the host.
const MAX_WAIT_MS = 2_000;

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
};

export class HostRateLimiter {
  private buckets = new Map<string, Bucket>();
  private limits = new Map<string, HostLimit>();
  private now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Sets the budget for a host (from a provider manifest or the remote config). */
  configure(host: string, limit: HostLimit): void {
    this.limits.set(host.toLowerCase(), limit);
    this.buckets.delete(host.toLowerCase());
  }

  private bucket(host: string): Bucket {
    let b = this.buckets.get(host);
    const limit = this.limits.get(host) ?? DEFAULT_LIMIT;
    if (!b) {
      b = { tokens: limit.burst, last: this.now(), rps: limit.rps, burst: limit.burst, closedUntil: 0 };
      this.buckets.set(host, b);
    }
    const t = this.now();
    b.tokens = Math.min(b.burst, b.tokens + ((t - b.last) / 1000) * b.rps);
    b.last = t;
    return b;
  }

  /** Resolves when `url` may be requested; throws RateLimitedError when its host is closed or busy. */
  async acquire(url: string, opts: { signal?: AbortSignal; background?: boolean } = {}): Promise<void> {
    const host = hostOf(url);
    if (!host) return;
    let waited = 0;
    for (;;) {
      if (opts.signal?.aborted) throw new Error('Request aborted');
      const b = this.bucket(host);
      if (this.now() < b.closedUntil) throw new RateLimitedError(host, 'closed');
      // Background requests leave at least half the budget to the user's own.
      if (opts.background && b.tokens <= b.burst / 2) throw new RateLimitedError(host, 'busy');
      if (b.tokens >= 1) { b.tokens -= 1; return; }
      const wait = Math.ceil(((1 - b.tokens) / b.rps) * 1000);
      // Bounded by time actually slept, so a stalled clock cannot keep a request waiting forever.
      if (waited + wait > MAX_WAIT_MS) throw new RateLimitedError(host, 'busy');
      waited += wait;
      // No abort listener per waiter (many requests share one signal); the signal is checked on waking.
      await new Promise(r => setTimeout(r, wait));
    }
  }

  /** The host answered 429: close it for `retryAfterMs` (or a default). */
  penalize(url: string, retryAfterMs?: number): void {
    const host = hostOf(url);
    if (!host) return;
    const ms = Math.min(MAX_PENALTY_MS, retryAfterMs && retryAfterMs > 0 ? retryAfterMs : DEFAULT_PENALTY_MS);
    const b = this.bucket(host);
    b.closedUntil = Math.max(b.closedUntil, this.now() + ms);
    b.tokens = 0;
  }

  isClosed(url: string): boolean {
    const host = hostOf(url);
    return Boolean(host) && this.now() < (this.buckets.get(host)?.closedUntil ?? 0);
  }
}

/** Reads a Retry-After header (seconds or an HTTP date) as ms. */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return secs * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

export const hostLimiter = new HostRateLimiter();

// Signals of background (prefetch) lookups: requests made under them yield to the user's own.
const backgroundSignals = new WeakSet<AbortSignal>();
export function markBackground(signal: AbortSignal): void { backgroundSignals.add(signal); }
export function isBackground(signal: AbortSignal | undefined): boolean { return Boolean(signal && backgroundSignals.has(signal)); }
