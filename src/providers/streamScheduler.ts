// streamScheduler.ts - Runs background stream lookups in priority order.
//
// What the user is looking at goes first. Jobs wait in a keyed priority queue
// and run a couple at a time. Background work also yields: while a lookup the
// user is waiting on (playback, next episode) is running, low-priority jobs are
// held back so they never compete with it for the network.
import { KeyedPriorityQueue } from './priorityQueue.ts';

/** Lower number = served first. */
export const Priority = {
  /** The user pressed Play / opened the player. Never queued: runs at once. */
  PLAYBACK: 0,
  /** The next episode of what is playing right now. */
  NEXT_EPISODE: 1,
  /** The title page the user has open. */
  DETAIL: 2,
  /** Hero billboard, Continue Watching, a tile the user hovers or focuses. */
  FOCUS: 3,
  /** Titles in the rail on screen. */
  RAIL: 4,
  /** Any other poster that rendered. */
  POSTER: 5,
  /** Anything else, only when nothing else wants the network. */
  IDLE: 6
} as const;

export interface SchedulerOptions {
  /** Background jobs running at the same time. */
  concurrency?: number;
  /** Longest queue kept; the lowest-priority jobs beyond it are dropped. */
  maxQueued?: number;
  /** A queued job at or below this priority (number >=) older than this is dropped as stale. */
  staleAfterMs?: number;
  staleFromPriority?: number;
  /** While an urgent lookup (priority <= this) runs, jobs below it wait. */
  urgentPriority?: number;
  now?: () => number;
}

export class StreamScheduler<P> {
  private queue: KeyedPriorityQueue<P>;
  private running = 0;
  private urgent = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly opts: Required<SchedulerOptions>;
  private run: (payload: P, key: string) => Promise<unknown>;

  constructor(run: (payload: P, key: string) => Promise<unknown>, options: SchedulerOptions = {}) {
    this.run = run;
    this.opts = {
      concurrency: 2,
      maxQueued: 100,
      staleAfterMs: 45_000,
      staleFromPriority: Priority.RAIL,
      urgentPriority: Priority.NEXT_EPISODE,
      now: Date.now,
      ...options
    };
    // What the user just scrolled to is the most likely tap: newest first for the
    // low priorities. Episodes keep their order.
    this.queue = new KeyedPriorityQueue<P>(p => (p >= Priority.FOCUS ? 'lifo' : 'fifo'), this.opts.now);
  }

  get queued(): number { return this.queue.size; }
  get active(): number { return this.running; }

  /** Queues (or promotes) a job. A key already queued keeps its best priority. */
  enqueue(key: string, payload: P, priority: number): 'added' | 'promoted' | 'duplicate' {
    const result = this.queue.push(key, payload, priority);
    if (result !== 'duplicate') {
      this.queue.trim(this.opts.maxQueued);
      this.schedulePump();
    }
    return result;
  }

  /** Forget a queued job (e.g. the user started that very lookup themselves). */
  cancel(key: string): boolean { return this.queue.cancel(key); }

  /** Registers a lookup the user is waiting on: background jobs yield until it ends. */
  trackUrgent(work: Promise<unknown>): void {
    this.urgent++;
    const done = () => { this.urgent--; this.schedulePump(); };
    work.then(done, done);
  }

  private schedulePump(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, 0);
  }

  private pump(): void {
    while (this.running < this.opts.concurrency) {
      const next = this.queue.peek();
      if (!next) return;
      // Hold everything that is not itself urgent while an urgent lookup runs.
      if (this.urgent > 0 && next.priority > this.opts.urgentPriority) return;
      this.queue.pop();
      if (next.priority >= this.opts.staleFromPriority && this.opts.now() - next.enqueuedAt > this.opts.staleAfterMs) continue;
      this.running++;
      Promise.resolve()
        .then(() => this.run(next.payload, next.key))
        .catch(() => undefined)
        .finally(() => { this.running--; this.schedulePump(); });
    }
  }
}
