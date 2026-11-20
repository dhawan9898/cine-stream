// race.ts - Runs one lookup's plan (planner.ts) and collects the streams it finds.
//
// Providers run as the plan says; what they return is either a direct stream (checked - right film,
// real quality and languages - then collected) or an embed page (queued for the sniffer). The race
// ends at the first of:
//   - a good stream is in hand: after EARLY_EXIT_GRACE_MS when nothing can beat it (streamElection
//     isSettled), after QUALITY_WAIT_MS otherwise, but never before a provider strong for the title's
//     language has answered or STRONG_PROVIDER_WAIT_MS has passed (it has the other languages);
//   - everyone has answered, every sniff is over and every check is done;
//   - RESOLVE_DEADLINE_MS, or the caller's signal.
// When it ends, every request and sniff still running is cancelled.
import { reportError } from '../../services/errorReporter.ts';
import type { ExtractParams, ExtractedStream, StreamExtractor } from '../core/types.ts';
import { manifestOf } from '../core/manifest.ts';
import { markBackground } from '../core/hostLimiter.ts';
import { recordTiming } from '../service/timings.ts';
import { isSettled, normalizeLanguages, type ElectionContext } from './election.ts';
import type { RacePlan } from './planner.ts';
import { SniffQueue } from './sniffQueue.ts';

export const RACE_LIMITS = {
  /** Per provider; multi-hop scrapers (search -> seasons -> episodes -> servers) get longer. */
  providerTimeoutMs: 6000,
  multiHopTimeoutMs: 9000,
  /** A working embed gives its stream in about 5 s; waiting longer only delays the next one. */
  sniffTimeoutMs: 9000,
  deadlineMs: 14000,
  earlyExitGraceMs: 250,
  /** The best stream in hand can still be beaten (below 1080p, theatrical, wrong language). */
  qualityWaitMs: 2000,
  /** Streams still being checked when the race would end get this long. */
  checkWaitMs: 1500,
  /** From the start, for a provider strong for the title's language. */
  strongProviderWaitMs: 7000,
  maxSniffs: 4,
  sniffConcurrency: 3,
  unhedgedSniffs: 2
};

export interface RaceParams extends ExtractParams {
  allowSniff?: boolean;
  preferredServerId?: string;
  /** Told about every embed page a provider returned (never played; sniffed or saved). */
  onEmbed?: (embed: ExtractedStream) => void;
  /** Nobody is waiting (a speculative lookup): requests and sniffs yield to the user's own. */
  sniffBackground?: boolean;
}

export interface RaceDeps {
  /** Right film and real facts (see registry#checkStream); false drops the stream. */
  check: (stream: ExtractedStream, signal: AbortSignal) => Promise<boolean>;
  sniff: (embed: ExtractedStream, signal: AbortSignal, background: boolean) => Promise<ExtractedStream | null>;
  recordResult: (providerId: string, ok: boolean, ms?: number) => void;
  expectedMs: (serverId: string) => number;
  hedgeDelayMs: (serverId: string) => number;
  /** A language-only provider's stream never ends the race on an English title. */
  languagesOnly: (s: ExtractedStream) => boolean;
  election: ElectionContext;
}

type Timer = ReturnType<typeof setTimeout> | undefined;

export class Race {
  private readonly found: ExtractedStream[] = [];
  private readonly ctl = new AbortController();
  private readonly sniffs: SniffQueue;
  private readonly startedAt = Date.now();
  private readonly canSniff: boolean;
  private pendingExtract: number;
  private strongPending: number;
  private verifying = 0;
  private othersStarted: boolean;
  private done = false;
  private checksDeadline = 0;
  private timers: { grace: Timer; strong: Timer; deadline: Timer; headStart: Timer } = { grace: undefined, strong: undefined, deadline: undefined, headStart: undefined };
  private resolve!: (streams: ExtractedStream[]) => void;
  private readonly onExternalAbort = () => this.finish();
  private readonly plan: RacePlan;
  private readonly params: RaceParams;
  private readonly deps: RaceDeps;
  private readonly limits: typeof RACE_LIMITS;

  constructor(plan: RacePlan, params: RaceParams, deps: RaceDeps, limits = RACE_LIMITS) {
    this.plan = plan;
    this.params = params;
    this.deps = deps;
    this.limits = limits;
    this.canSniff = params.allowSniff !== false;
    this.pendingExtract = plan.head.length + plan.rest.length;
    this.strongPending = plan.strongIds.size;
    this.othersStarted = plan.rest.length === 0 || plan.headStartMs <= 0;
    // A speculative lookup's requests yield to the user's own (see hostLimiter.ts).
    if (params.sniffBackground) markBackground(this.ctl.signal);
    this.sniffs = new SniffQueue({
      sniff: embed => deps.sniff(embed, this.ctl.signal, Boolean(params.sniffBackground)),
      onResult: (embed, stream, ms) => this.onSniffed(embed, stream, ms),
      expectedMs: deps.expectedMs,
      hedgeDelayMs: deps.hedgeDelayMs,
      favouriteId: plan.lastGoodId,
      maxAttempts: limits.maxSniffs,
      concurrency: limits.sniffConcurrency,
      unhedged: limits.unhedgedSniffs
    });
  }

  /** Every checked direct stream found, in the order they were found. */
  run(): Promise<ExtractedStream[]> {
    return new Promise(resolve => {
      this.resolve = resolve;
      const external = this.params.signal;
      this.timers.deadline = setTimeout(() => this.finish(), this.limits.deadlineMs);
      if (this.pendingExtract === 0 || external?.aborted) { this.finish(); return; }
      external?.addEventListener('abort', this.onExternalAbort, { once: true });
      const first = this.othersStarted ? [...this.plan.head, ...this.plan.rest] : this.plan.head;
      this.launch(first);
      if (!this.othersStarted) this.timers.headStart = setTimeout(() => this.startOthers(), this.plan.headStartMs);
    });
  }

  // ---- lifecycle ----------------------------------------------------------------------

  private launch(providers: StreamExtractor[]): void {
    // Every early embed is queued before any sniff starts, so the best-ranked ones get the WebViews.
    providers.forEach(p => this.queueKnownEmbed(p));
    this.sniffs.pump();
    providers.forEach(p => this.runProvider(p));
  }

  /** The rest of the plan: after the head start, or as soon as the head group came up empty. */
  private startOthers(): void {
    if (this.othersStarted || this.done) return;
    this.othersStarted = true;
    if (this.timers.headStart) clearTimeout(this.timers.headStart);
    this.launch(this.plan.rest);
    this.maybeFinish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.params.signal?.removeEventListener('abort', this.onExternalAbort);
    this.ctl.abort();
    this.sniffs.stop();
    Object.values(this.timers).forEach(t => t && clearTimeout(t));
    this.resolve(this.found.filter(s => !s.isFallbackEmbed));
  }

  /** Ends the race when nothing is left that could still find a stream. */
  private maybeFinish(): void {
    if (this.done) return;
    const nothingInFlight = this.verifying === 0 && this.sniffs.active === 0;
    if (!this.othersStarted) {
      const headDone = this.pendingExtract <= this.plan.rest.length;
      // The head group came up empty: no need to sit out the rest of its head start.
      if (headDone && nothingInFlight && this.sniffs.waiting === 0 && this.found.length === 0) this.startOthers();
      return;
    }
    if (this.pendingExtract === 0 && nothingInFlight && this.sniffs.settled) this.finish();
  }

  /** A stream is in hand: decide how much longer the race is worth. */
  private finishSoon(): void {
    const { preferredServerId } = this.params;
    if (preferredServerId && !this.found.some(s => s.serverId === preferredServerId)) return;
    const { election } = this.deps;
    // On an English title a language-only provider's stream (Movierulz, often from its cache in a
    // second) never ends the race; on a regional title it competes like everyone else.
    const mains = this.found.filter(s => !s.isFallbackEmbed && (election.regional || !this.deps.languagesOnly(s)));
    if (mains.length === 0) return;
    // The provider with this title's other languages is still at work: give it its time.
    const strongHasStream = this.found.some(s => !s.isFallbackEmbed && this.plan.strongIds.has(s.serverId ?? ''));
    if (this.strongPending > 0 && !strongHasStream) {
      const wait = this.limits.strongProviderWaitMs - (Date.now() - this.startedAt);
      if (wait > 0) {
        this.timers.strong ??= setTimeout(() => this.finishWhenChecked(), wait);
        return;
      }
    }
    const settled = mains.some(s => isSettled(s, election));
    this.timers.grace ??= setTimeout(() => this.finishWhenChecked(), settled ? this.limits.earlyExitGraceMs : this.limits.qualityWaitMs);
  }

  /** Streams found but still being checked are not thrown away by the end of the race. */
  private finishWhenChecked(): void {
    if (this.done) return;
    if (this.verifying > 0) {
      this.checksDeadline ||= Date.now() + this.limits.checkWaitMs;
      if (Date.now() < this.checksDeadline) {
        this.timers.grace = setTimeout(() => this.finishWhenChecked(), 100);
        return;
      }
    }
    this.finish();
  }

  // ---- inputs ---------------------------------------------------------------------------

  /** A direct stream counts once its check passes; checks run side by side with the race. */
  private accept(stream: ExtractedStream): void {
    this.verifying++;
    void this.deps.check(stream, this.ctl.signal).catch(() => true).then(ok => {
      this.verifying--;
      if (this.done) return;
      if (ok) {
        this.found.push(normalizeLanguages(stream));
        this.finishSoon();
      }
      this.maybeFinish();
    });
  }

  private onSniffed(embed: ExtractedStream, stream: ExtractedStream | null, ms: number): void {
    const { params } = this;
    recordTiming({ phase: 'sniff', ms, serverId: embed.serverId, titleId: params.id, title: params.title, outcome: stream ? 'sniffed' : 'failed' });
    // A speculative sniff that was refused or cut short says nothing about the provider.
    if (stream || !params.sniffBackground) this.deps.recordResult(embed.serverId ?? 'unknown', Boolean(stream), Date.now() - this.startedAt);
    if (stream) this.accept({ ...stream, serverId: embed.serverId, serverName: embed.serverName });
    this.maybeFinish();
  }

  /** Queues the provider's embed page right away when it can name it without a request. */
  private queueKnownEmbed(provider: StreamExtractor): void {
    if (!this.canSniff || !provider.embedUrl) return;
    let url: string | null = null;
    try { url = provider.embedUrl(this.params); } catch { /* no fixed page */ }
    if (!url) return;
    const early: ExtractedStream = { url, format: 'hls', isFallbackEmbed: true, serverId: provider.id, serverName: provider.name };
    this.params.onEmbed?.(early);
    this.sniffs.add(early);
  }

  private runProvider(provider: StreamExtractor): void {
    const { params } = this;
    const limitMs = manifestOf(provider).costHint === 'multi-hop' ? this.limits.multiHopTimeoutMs : this.limits.providerTimeoutMs;
    let timer: Timer;
    const timeout = new Promise<null>(r => { timer = setTimeout(() => r(null), limitMs); });
    const startedAt = Date.now();
    const call: ExtractParams = { ...params, signal: this.ctl.signal };
    // Providers that report every server/lane they found hand all of them over (alternates for the
    // player); the rest give their single best.
    const attempt = (async (): Promise<ExtractedStream[]> => {
      if (provider.extractAll) return provider.extractAll(call);
      const one = await provider.extract(call);
      return one ? [one] : [];
    })();

    Promise.race([attempt, timeout])
      .catch(err => {
        // Thrown, not just "nothing found": a broken provider or site. Cancelled ones (another provider
        // already won) and rate limits (the host limiter already gives the site its pause) are expected.
        const expected = err instanceof Error && (/abort/i.test(err.name + err.message) || /\b429\b|rate limited/i.test(err.message));
        if (!this.ctl.signal.aborted && !expected) {
          reportError('provider', err, { provider: provider.id, title: params.title, id: params.id, type: params.type, season: params.season, episode: params.episode, ms: Date.now() - startedAt });
        }
        return null;
      })
      .then(result => {
        clearTimeout(timer);
        const elapsed = Date.now() - startedAt;
        const streams = (result ?? []).filter(s => s && s.url && s.url.trim().length > 0);
        const directs = streams.filter(s => !s.isFallbackEmbed);
        recordTiming({
          phase: 'extract', ms: elapsed, serverId: provider.id, titleId: params.id, title: params.title,
          outcome: streams.length === 0 ? (elapsed >= limitMs - 50 ? 'timeout' : 'none') : directs.length > 0 ? 'direct' : 'embed'
        });
        if (this.done) return;
        if (streams.length === 0) { this.deps.recordResult(provider.id, false); return; }
        if (directs.length > 0) this.deps.recordResult(provider.id, true, elapsed);
        const ttl = manifestOf(provider).linkTtlMs;
        for (const stream of streams) {
          const tagged: ExtractedStream = {
            ...stream,
            serverId: stream.serverId || provider.id,
            serverName: stream.serverName || provider.name,
            ...(ttl !== undefined && stream.revalidateAfterMs === undefined ? { revalidateAfterMs: ttl } : {})
          };
          if (!tagged.isFallbackEmbed) this.accept(tagged);
          else if (!this.plan.blockedEmbeds.has(tagged.url)) {
            // Neither a success nor a failure until it is sniffed (or cannot be: a prefetch, the web).
            params.onEmbed?.(tagged);
            if (this.canSniff) this.sniffs.add(tagged);
          }
        }
      })
      .finally(() => {
        this.pendingExtract--;
        if (this.plan.strongIds.has(provider.id)) {
          this.strongPending--;
          // It answered (with or without a stream): nothing more to wait for if one is in hand.
          if (this.found.some(s => !s.isFallbackEmbed)) this.finishSoon();
        }
        this.sniffs.pump();
        this.maybeFinish();
      });
  }
}
