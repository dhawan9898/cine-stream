// providerStats.ts - What the app has learned about each provider, used to pick
// which one to ask first and which to leave alone.
//
// Per provider it keeps:
//  - how long it takes to deliver a playable stream (a moving average) and how
//    often it succeeds, so providers can be ranked by expected time to a stream;
//  - a circuit breaker. After repeated failures the breaker opens and the
//    provider is skipped. After a backoff it goes half-open: exactly one probe is
//    let through, and a success closes it again. A failed probe doubles the
//    backoff (up to a cap), so a recovered host comes back without waiting out a
//    fixed cooldown and a dead one is not hammered.
//
// Failures with no network (offline) must not be recorded: they say nothing about
// the provider.

export type BreakerState = 'closed' | 'open' | 'half-open';

interface Stat {
  /** Moving average of ms to a playable stream (successes only). */
  ms: number;
  /** Moving average success rate, 0..1. */
  rate: number;
  samples: number;
  fails: number;
  /** When an open breaker lets one probe through. */
  nextProbeAt: number;
  backoffMs: number;
  /** When the in-flight probe started (0 = none). A probe that never reports back expires. */
  probeAt: number;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ProviderStatsOptions {
  storageKey?: string;
  store?: KeyValueStore;
  now?: () => number;
  failsToOpen?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Weight of a new sample in the moving averages. */
  alpha?: number;
}

/** Assumed time for a provider nothing is known about yet: neither favoured nor avoided. */
const UNKNOWN_MS = 4000;
/** A probe that has not reported back by now is given up on, so the breaker cannot stay stuck. */
const PROBE_EXPIRES_MS = 30_000;
/** A provider must have this track record before the alternative is made to wait for it. */
const HEDGE_MIN_SAMPLES = 3;
const HEDGE_MIN_RATE = 0.7;
/** A provider that always fails still ranks, just far behind. */
const MIN_RATE = 0.05;

export class ProviderStats {
  private stats: Record<string, Stat> = {};
  private readonly store: KeyValueStore | undefined;
  private readonly key: string | undefined;
  private readonly now: () => number;
  private readonly failsToOpen: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly alpha: number;

  constructor(opts: ProviderStatsOptions = {}) {
    this.store = opts.store ?? (() => { try { return globalThis.localStorage; } catch { return undefined; } })();
    this.key = opts.storageKey;
    this.now = opts.now ?? Date.now;
    this.failsToOpen = opts.failsToOpen ?? 3;
    this.baseBackoffMs = opts.baseBackoffMs ?? 30_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 10 * 60_000;
    this.alpha = opts.alpha ?? 0.3;
    if (this.key && this.store) {
      try {
        const raw = this.store.getItem(this.key);
        if (raw) this.stats = JSON.parse(raw);
        // A probe that was in flight when the app closed never reported back.
        Object.values(this.stats).forEach(s => { s.probeAt = 0; });
      } catch { this.stats = {}; }
    }
  }

  private get(id: string): Stat {
    return (this.stats[id] ??= { ms: UNKNOWN_MS, rate: 0.5, samples: 0, fails: 0, nextProbeAt: 0, backoffMs: this.baseBackoffMs, probeAt: 0 });
  }

  private save(): void {
    if (!this.key || !this.store) return;
    try { this.store.setItem(this.key, JSON.stringify(this.stats)); } catch { /* storage unavailable */ }
  }

  state(id: string): BreakerState {
    const s = this.stats[id];
    if (!s || s.fails < this.failsToOpen) return 'closed';
    return this.now() >= s.nextProbeAt ? 'half-open' : 'open';
  }

  /**
   * Whether the provider may be asked now. Closed: yes. Open: no. Half-open: yes for one
   * caller only (the probe); the others wait for its result.
   */
  tryAcquire(id: string): boolean {
    const st = this.state(id);
    if (st === 'closed') return true;
    if (st === 'open') return false;
    const s = this.get(id);
    if (s.probeAt > 0 && this.now() - s.probeAt < PROBE_EXPIRES_MS) return false;
    s.probeAt = this.now();
    return true;
  }

  /** Records how a lookup went. `ms` is the time to a playable stream (successes only). */
  record(id: string, ok: boolean, ms?: number): void {
    const s = this.get(id);
    s.probeAt = 0;
    s.samples++;
    s.rate = s.rate * (1 - this.alpha) + (ok ? 1 : 0) * this.alpha;
    if (ok) {
      if (ms !== undefined && ms >= 0) s.ms = s.samples <= 1 ? ms : s.ms * (1 - this.alpha) + ms * this.alpha;
      s.fails = 0;
      s.backoffMs = this.baseBackoffMs;
      s.nextProbeAt = 0;
    } else {
      const wasOpen = s.fails >= this.failsToOpen;
      s.fails++;
      if (s.fails >= this.failsToOpen) {
        // A failed probe doubles the wait; the first opening uses the base wait.
        s.backoffMs = wasOpen ? Math.min(this.maxBackoffMs, s.backoffMs * 2) : this.baseBackoffMs;
        s.nextProbeAt = this.now() + s.backoffMs;
      }
    }
    this.save();
  }

  /** Expected ms until this provider delivers a stream: slower and flakier ranks worse. */
  expectedMs(id: string): number {
    const s = this.stats[id];
    if (!s || s.samples === 0) return UNKNOWN_MS;
    return s.ms / Math.max(MIN_RATE, s.rate);
  }

  /** Providers best first. Ties keep the given order. `bias` subtracts from the expected ms. */
  rank<T extends { id: string }>(items: T[], bias: (id: string) => number = () => 0): T[] {
    return items
      .map((item, index) => ({ item, index, score: this.expectedMs(item.id) - bias(item.id) }))
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map(x => x.item);
  }

  /**
   * How long to wait for `id` before also starting the next-best provider: a little past
   * its usual time, bounded so a fast provider is not pestered and a slow one not awaited forever.
   * 0 (no waiting) unless `id` has a proven track record.
   */
  hedgeDelayMs(id: string): number {
    const s = this.stats[id];
    // Without a proven record there is nothing to wait for: start the alternative at once.
    if (!s || s.samples < HEDGE_MIN_SAMPLES || s.rate < HEDGE_MIN_RATE) return 0;
    return Math.round(Math.min(2500, Math.max(400, s.ms * 1.5)));
  }

  snapshot(): Record<string, { ms: number; rate: number; samples: number; state: BreakerState }> {
    const out: Record<string, { ms: number; rate: number; samples: number; state: BreakerState }> = {};
    for (const [id, s] of Object.entries(this.stats)) out[id] = { ms: Math.round(s.ms), rate: Math.round(s.rate * 100) / 100, samples: s.samples, state: this.state(id) };
    return out;
  }
}
