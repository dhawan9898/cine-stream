// ttlStore.ts - A small persistent key/value cache with per-entry expiry and a size cap.
// Backed by one localStorage entry (small values only: ids and maps, never streams); the newest
// entries win when the cap is reached. Works without storage (memory only).

interface Entry<T> { v: T; at: number; exp: number }

export class TtlStore<T> {
  private mem: Record<string, Entry<T>> | null = null;
  private readonly storageKey: string;
  private readonly max: number;
  private readonly now: () => number;

  constructor(storageKey: string, max = 2000, now: () => number = Date.now) {
    this.storageKey = storageKey;
    this.max = max;
    this.now = now;
  }

  private load(): Record<string, Entry<T>> {
    if (this.mem) return this.mem;
    try {
      const raw = globalThis.localStorage?.getItem(this.storageKey);
      this.mem = raw ? JSON.parse(raw) : {};
    } catch {
      this.mem = {};
    }
    return this.mem!;
  }

  private save(): void {
    try { globalThis.localStorage?.setItem(this.storageKey, JSON.stringify(this.mem ?? {})); } catch { /* storage full or unavailable */ }
  }

  /** The value, or undefined when absent or expired. `has` tells an expired/absent entry from a stored null. */
  get(key: string): { has: boolean; value?: T } {
    const e = this.load()[key];
    if (!e) return { has: false };
    if (e.exp <= this.now()) {
      delete this.mem![key];
      return { has: false };
    }
    return { has: true, value: e.v };
  }

  set(key: string, value: T, ttlMs: number): void {
    const all = this.load();
    const t = this.now();
    all[key] = { v: value, at: t, exp: t + ttlMs };
    const keys = Object.keys(all);
    if (keys.length > this.max) {
      keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - this.max).forEach(k => delete all[k]);
    }
    this.save();
  }

  delete(key: string): void {
    const all = this.load();
    if (key in all) {
      delete all[key];
      this.save();
    }
  }
}
