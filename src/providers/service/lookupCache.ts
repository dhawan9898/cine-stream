// lookupCache.ts - One running (or recent) lookup per key, shared by everyone who asks for it.
//
// A lookup is cancelled - its requests and sniffers freed - once every caller that passed a signal has
// gone and nobody without one (a prefetch, which never leaves) is relying on it. A caller that leaves
// and comes straight back (a React effect re-running) keeps the same lookup (RELEASE_GRACE_MS).
// Settled lookups are reused for REUSE_MS; the persistent link store keeps them for longer.

export interface LookupFlags {
  /** A background lookup (no sniffer unless speculative). */
  prefetch: boolean;
  /** A speculative one: a user's own lookup never waits on it. */
  speculative?: boolean;
}

export interface LookupEntry<T> extends LookupFlags {
  at: number;
  promise: Promise<T>;
  readonly ctl: AbortController;
  holders: number;
  /** Someone without a signal relies on it: never cancelled. */
  pinned: boolean;
  settled: boolean;
}

export const abortError = (): Error => Object.assign(new Error('Stream lookup cancelled'), { name: 'AbortError' });

export class LookupCache<T extends object> {
  private readonly entries = new Map<string, LookupEntry<T>>();
  private readonly reuseMs: number;
  private readonly max: number;
  private readonly graceMs: number;

  constructor(opts: { reuseMs?: number; max?: number; graceMs?: number } = {}) {
    this.reuseMs = opts.reuseMs ?? 30 * 60_000;
    this.max = opts.max ?? 150;
    this.graceMs = opts.graceMs ?? 300;
  }

  /** The entry for `key` while it is running or recent enough to reuse. */
  get(key: string): LookupEntry<T> | undefined {
    const e = this.entries.get(key);
    return e && Date.now() - e.at < this.reuseMs ? e : undefined;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Forgets every settled lookup (running ones keep their callers). */
  clearSettled(): void {
    for (const [k, e] of this.entries) if (e.settled) this.entries.delete(k);
  }

  start(key: string, flags: LookupFlags, run: (signal: AbortSignal) => Promise<T>): LookupEntry<T> {
    const ctl = new AbortController();
    const entry: LookupEntry<T> = { at: Date.now(), ...flags, ctl, holders: 0, pinned: false, settled: false, promise: run(ctl.signal) };
    entry.promise.then(
      () => { entry.settled = true; },
      () => { entry.settled = true; if (this.entries.get(key) === entry) this.entries.delete(key); }
    );
    this.entries.set(key, entry);
    this.prune();
    return entry;
  }

  /** Hands the entry's result to one caller (a copy each); `signal` lets that caller leave. */
  attach(key: string, entry: LookupEntry<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
      entry.pinned = true;
      return entry.promise.then(v => ({ ...v }));
    }
    if (signal.aborted) return Promise.reject(abortError());
    entry.holders++;
    let released = false;
    const release = () => { if (!released) { released = true; entry.holders--; } };
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(abortError());
        setTimeout(() => {
          release();
          if (entry.holders <= 0 && !entry.pinned && !entry.settled) {
            entry.ctl.abort();
            if (this.entries.get(key) === entry) this.entries.delete(key);
          }
        }, this.graceMs);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        v => { signal.removeEventListener('abort', onAbort); release(); resolve({ ...v }); },
        e => { signal.removeEventListener('abort', onAbort); release(); reject(e); }
      );
    });
  }

  private prune(now = Date.now()): void {
    for (const [k, e] of this.entries) if (e.settled && now - e.at > this.reuseMs) this.entries.delete(k);
    // Oldest first (insertion order); lookups still running are kept.
    for (const [k, e] of this.entries) {
      if (this.entries.size <= this.max) break;
      if (e.settled) this.entries.delete(k);
    }
  }
}

/** Keys that just failed for everyone: background work leaves them alone for a while. */
export class FailureMemo {
  private readonly until = new Map<string, number>();
  private readonly ms: number;
  constructor(ms: number) { this.ms = ms; }
  note(key: string): void { this.until.set(key, Date.now() + this.ms); this.prune(); }
  clear(key?: string): void { if (key === undefined) this.until.clear(); else this.until.delete(key); }
  has(key: string): boolean { return (this.until.get(key) ?? 0) > Date.now(); }
  private prune(): void { const now = Date.now(); for (const [k, t] of this.until) if (t <= now) this.until.delete(k); }
}
