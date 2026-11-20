// priorityQueue.ts - A keyed binary min-heap.
//
// Lower number = higher priority. Entries are unique per key: pushing a key that
// is already queued either does nothing or, with a better priority, promotes it.
// Ties are broken by `order`: 'fifo' (oldest first) or 'lifo' (newest first).

export interface QueueEntry<T> {
  key: string;
  priority: number;
  payload: T;
  /** Insertion counter, used for tie-breaking. */
  seq: number;
  enqueuedAt: number;
}

export type TieOrder = 'fifo' | 'lifo';

export class KeyedPriorityQueue<T> {
  private heap: QueueEntry<T>[] = [];
  // Live entry per key. Superseded (promoted/cancelled) heap entries are dropped lazily on pop.
  private live = new Map<string, QueueEntry<T>>();
  private seq = 0;

  private tieOrder: (priority: number) => TieOrder;
  private now: () => number;

  /** `tieOrder` picks the tie-break order for entries of equal priority. */
  constructor(tieOrder: (priority: number) => TieOrder = () => 'fifo', now: () => number = Date.now) {
    this.tieOrder = tieOrder;
    this.now = now;
  }

  get size(): number { return this.live.size; }
  has(key: string): boolean { return this.live.has(key); }
  priorityOf(key: string): number | undefined { return this.live.get(key)?.priority; }

  /** Adds `key`, or promotes it when already queued with a worse priority. Returns what happened. */
  push(key: string, payload: T, priority: number): 'added' | 'promoted' | 'duplicate' {
    const existing = this.live.get(key);
    if (existing && existing.priority <= priority) return 'duplicate';
    const entry: QueueEntry<T> = { key, priority, payload, seq: this.seq++, enqueuedAt: existing?.enqueuedAt ?? this.now() };
    this.live.set(key, entry);
    this.siftUp(this.heap.push(entry) - 1);
    return existing ? 'promoted' : 'added';
  }

  /** Removes and returns the highest-priority entry, or undefined when empty. */
  pop(): QueueEntry<T> | undefined {
    while (this.heap.length > 0) {
      const top = this.heap[0];
      const last = this.heap.pop()!;
      if (this.heap.length > 0) {
        this.heap[0] = last;
        this.siftDown(0);
      }
      if (this.live.get(top.key) === top) {
        this.live.delete(top.key);
        return top;
      }
    }
    return undefined;
  }

  /** The entry pop() would return next, without removing it. */
  peek(): QueueEntry<T> | undefined {
    while (this.heap.length > 0 && this.live.get(this.heap[0].key) !== this.heap[0]) {
      const last = this.heap.pop()!;
      if (this.heap.length > 0) { this.heap[0] = last; this.siftDown(0); }
    }
    return this.heap[0];
  }

  cancel(key: string): boolean { return this.live.delete(key); }

  clear(): void { this.heap = []; this.live.clear(); }

  /** Drops the lowest-priority entries until at most `max` remain. Returns how many were dropped. */
  trim(max: number): number {
    let dropped = 0;
    while (this.live.size > max) {
      let worst: QueueEntry<T> | undefined;
      for (const e of this.live.values()) {
        if (!worst || this.before(worst, e)) worst = e; // `worst` is the one that would pop last
      }
      if (!worst) break;
      this.live.delete(worst.key);
      dropped++;
    }
    return dropped;
  }

  /** True when `a` must leave the queue before `b`. */
  private before(a: QueueEntry<T>, b: QueueEntry<T>): boolean {
    if (a.priority !== b.priority) return a.priority < b.priority;
    return this.tieOrder(a.priority) === 'lifo' ? a.seq > b.seq : a.seq < b.seq;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(this.heap[i], this.heap[parent])) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let best = i;
      if (l < n && this.before(this.heap[l], this.heap[best])) best = l;
      if (r < n && this.before(this.heap[r], this.heap[best])) best = r;
      if (best === i) return;
      [this.heap[i], this.heap[best]] = [this.heap[best], this.heap[i]];
      i = best;
    }
  }
}
