// sniffQueue.ts - Embed pages waiting for a hidden WebView (the native sniffer), best first.
//
// A WebView is the most expensive thing a lookup can use, so pages are taken in order of how likely
// they are to give a stream soon: the provider that played this title last time first, then by learned
// expected time. Two run side by side from the start; a third only once the running ones have had
// their usual time (a hedge), and no lookup sniffs more than `maxAttempts` pages.
import type { ExtractedStream } from '../core/types.ts';

export interface SniffQueueOptions {
  sniff: (embed: ExtractedStream) => Promise<ExtractedStream | null>;
  /** Told about every finished sniff (stream or null) with how long it took. */
  onResult: (embed: ExtractedStream, stream: ExtractedStream | null, ms: number) => void;
  /** Learned expected ms of a provider (queue order). */
  expectedMs: (serverId: string) => number;
  /** How long a running sniff of that provider is given before another one starts beside it. */
  hedgeDelayMs: (serverId: string) => number;
  /** Goes to the front of the queue. */
  favouriteId?: string;
  maxAttempts?: number;
  concurrency?: number;
  unhedged?: number;
}

export class SniffQueue {
  private queue: ExtractedStream[] = [];
  private seen = new Set<string>();
  private running = 0;
  private started = 0;
  private lastStart = 0;
  private lastServer: string | undefined;
  private hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private readonly maxAttempts: number;
  private readonly concurrency: number;
  private readonly unhedged: number;
  private readonly opts: SniffQueueOptions;

  constructor(opts: SniffQueueOptions) {
    this.opts = opts;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.concurrency = opts.concurrency ?? 3;
    this.unhedged = opts.unhedged ?? 2;
  }

  /** Sniffs running now. */
  get active(): number { return this.running; }
  /** Pages still waiting. */
  get waiting(): number { return this.queue.length; }
  /** No more sniffs will start: the attempt budget is spent. */
  get exhausted(): boolean { return this.started >= this.maxAttempts; }
  /** Nothing running and nothing more that will run. */
  get settled(): boolean { return this.running === 0 && (this.queue.length === 0 || this.exhausted); }

  /** Queues a page (once per address), in order. Does not start it: call pump(). */
  add(embed: ExtractedStream): void {
    if (this.stopped || this.seen.has(embed.url)) return;
    this.seen.add(embed.url);
    const fav = this.opts.favouriteId;
    if (fav && embed.serverId === fav) { this.queue.unshift(embed); return; }
    // Best provider first; ties keep arrival order, and the favourite stays in front.
    const score = this.opts.expectedMs(embed.serverId ?? '');
    let at = this.queue.length;
    while (at > 0 && this.opts.expectedMs(this.queue[at - 1].serverId ?? '') > score && this.queue[at - 1].serverId !== fav) at--;
    this.queue.splice(at, 0, embed);
  }

  /** Starts as many queued pages as the limits allow now (and schedules a hedged one). */
  pump(): void {
    while (!this.stopped && this.running < this.concurrency && !this.exhausted && this.queue.length > 0) {
      if (this.running >= this.unhedged) {
        const wait = this.opts.hedgeDelayMs(this.lastServer ?? '') - (Date.now() - this.lastStart);
        if (wait > 0) {
          this.hedgeTimer ??= setTimeout(() => { this.hedgeTimer = undefined; this.pump(); }, wait);
          return;
        }
      }
      const embed = this.queue.shift()!;
      this.running++;
      this.started++;
      const startedAt = Date.now();
      this.lastStart = startedAt;
      this.lastServer = embed.serverId;
      this.opts.sniff(embed).catch(() => null).then(stream => {
        this.running--;
        if (this.stopped) return;
        this.opts.onResult(embed, stream, Date.now() - startedAt);
        this.pump();
      });
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.hedgeTimer) clearTimeout(this.hedgeTimer);
  }
}
