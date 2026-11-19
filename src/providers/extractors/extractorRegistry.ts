// extractorRegistry.ts - Central registry for real title-specific stream extractors
import { LANGUAGE_NAMES } from './variantDiscovery.ts';
import { reportError } from '../../services/errorReporter.ts';
import type { StreamExtractor, ExtractedStream, ExtractParams } from './types.ts';
import { isCheap, manifestOf, priorMs, strongFor, strongForLanguage, trustRank } from './manifest.ts';
import { markBackground } from './hostLimiter.ts';
import { FlixHQSource } from '../sources/flixhq.ts';
import { JellyfinSource } from '../sources/jellyfin.ts';
import { sniffDirectStream } from '../webSniffer.ts';
import { LastGoodStore } from 'streamkit/providers/health.ts';
import { ProviderStats } from './providerStats.ts';
import { recordTiming } from '../streamTimings.ts';
import { getProviderOverride, isProviderEnabled, subscribeProviderConfig, type ProviderConfig } from '../providerConfig.ts';
import { ApiExtractor } from './apiExtractor.ts';
import { FlixeoExtractor } from './flixeoExtractor.ts';
import { MovierulzExtractor } from './movierulzExtractor.ts';
import { VidLinkExtractor } from './vidlinkExtractor.ts';
import { VidRockExtractor } from './vidrockExtractor.ts';
import { RivestreamExtractor } from './rivestreamExtractor.ts';
import { MovyExtractor } from './movyExtractor.ts';
import { HDHub4UExtractor } from './hdhub4uExtractor.ts';
import { DesiCinemasExtractor } from './desicinemasExtractor.ts';
import { EinthusanExtractor } from './einthusanExtractor.ts';
import { IsaiminiExtractor } from './isaiminiExtractor.ts';
import { filterBestPrintStreams } from './printClassifier.ts';
import { heightOf, inspectStream, isWrongLength } from './streamCheck.ts';

const MAX_SNIFF_ATTEMPTS = 4;
// The best two embeds are sniffed side by side from the start; a third only after the hedge delay.
const SNIFF_CONCURRENCY = 3;
const UNHEDGED_SNIFFS = 2;
const PROVIDER_TIMEOUT_MS = 6000;
// Multi-hop scrapers (search -> seasons -> episodes -> servers -> source) need longer the first time a
// title is seen; their id and episode caches make later lookups much shorter.
const MULTI_HOP_TIMEOUT_MS = 9000;
// A working embed gives its stream in about 5 s once ads are blocked and Play is pressed in every
// frame (see the native sniffer); waiting much longer only delays the next provider.
const SNIFF_TIMEOUT_MS = 9000;
const RESOLVE_DEADLINE_MS = 14000;
// The provider that worked for this title last time runs alone this long before the others join.
const LAST_GOOD_HEAD_START_MS = 1200;
// Cheap providers (JSON APIs, self-hosted: manifest costHint 'instant'/'api') run alone for about the time
// they usually need - 1.5x the second-fastest one's expected time, within these bounds; the expensive ones
// (WebView sniffs, multi-hop scrapers) join after that, or at once when every cheap one has failed.
const CHEAP_HEAD_START_MIN_MS = 800;
const CHEAP_HEAD_START_MAX_MS = 3500;
const EARLY_EXIT_GRACE_MS = 250;
// The first stream in hand is below 1080p: the race waits this long for a sharper one.
const QUALITY_WAIT_MS = 2000;
// Streams still being checked when the race would end get this long to finish (see checkStream).
const CHECK_WAIT_MS = 1500;
// A title in a language some provider is strong for (Telugu, Tamil, Hindi... films on Movierulz): the
// race waits this long from its start for that provider before settling for a faster stream. The
// fast providers usually have one language only, so without the wait the Audio menu never appears.
const STRONG_PROVIDER_WAIT_MS = 7000;
const HEALTH_KEY = 'cinestream_provider_stats_v2';
const FAILS_BEFORE_COOLDOWN = 3;
const COOLDOWN_MS = 10 * 60 * 1000;

/** Head start (ms of expected time) for a provider whose manifest says it suits the title (kind/language). */
const PRIMARY_BIAS_MS = 1500;
const LAST_GOOD_KEY = 'cinestream_last_good_v1';
// How long the film's runtime may take to arrive (it is usually cached from the title page).
const RUNTIME_WAIT_MS = 2000;
// The final pick ranks by quality tier first (a tier outweighs any difference in speed), then speed.
const QUALITY_TIER_MS = 1_000_000;
// Within a tier: the provider that worked last time, or a stream with the title's own language.
const TIE_BONUS_MS = 1500;
const LAST_GOOD_MAX = 300;

type Sniffer = (embed: ExtractedStream, signal?: AbortSignal, background?: boolean) => Promise<ExtractedStream | null>;

const REGIONAL_PROVIDER_IDS = new Set(['movierulz', 'hdhub4u', 'desicinemas', 'einthusan', 'isaimini']);

export class ExtractorRegistry {
  private extractors: StreamExtractor[] = [];
  private sniffer: Sniffer = (embed, signal, background) => sniffDirectStream(embed, SNIFF_TIMEOUT_MS, signal, background);
  // Learned speed and reliability per provider; also the circuit breaker (see providerStats.ts).
  private stats = new ProviderStats({
    storageKey: HEALTH_KEY,
    failsToOpen: FAILS_BEFORE_COOLDOWN,
    baseBackoffMs: COOLDOWN_MS / 20,
    maxBackoffMs: COOLDOWN_MS
  });
  private lastGood = new LastGoodStore(LAST_GOOD_KEY, LAST_GOOD_MAX);
  // The film's TMDB runtime in minutes (set by streamResolver.ts), to tell a wrong title by its length.
  private runtimeLookup: (id: number) => Promise<number | undefined> = async () => undefined;
  // Reads a stream's playlist (see streamCheck.ts); a registry without the default providers (tests) skips it.
  private inspect: typeof inspectStream = inspectStream;

  setStreamInspector(fn: typeof inspectStream) {
    this.inspect = fn;
  }

  setRuntimeLookup(fn: (id: number) => Promise<number | undefined>) {
    this.runtimeLookup = fn;
  }

  /** Providers that only add languages (Movierulz, HDHub4U, etc.): their stream is the main one only when nothing else is found. */
  private languagesOnly(s: ExtractedStream): boolean {
    const e = s.serverId ? this.extractors.find(x => x.id === s.serverId) : undefined;
    return Boolean(e && (manifestOf(e).languagesOnly || REGIONAL_PROVIDER_IDS.has(e.id)));
  }

  /**
   * Looks inside a found stream: drops one whose length does not fit the film (another title), and
   * notes its real height for the final pick. Unknown length or an unreadable playlist passes.
   */
  private async checkStream(stream: ExtractedStream, runtime: Promise<number | undefined>, title: { id: number; title?: string }, signal?: AbortSignal): Promise<boolean> {
    const [facts, expected] = await Promise.all([this.inspect(stream, signal).catch(() => ({})), runtime]) as [Awaited<ReturnType<typeof inspectStream>>, number | undefined];
    if (facts.height) stream.height = facts.height;
    if (!isWrongLength(facts.minutes, expected)) return true;
    // Not counted against the provider: a wrong title is about this film (often a regional one sharing
    // its name with another), and three of them must not switch a good provider off for every title.
    reportError('provider', `${stream.serverName ?? stream.serverId} gave a different title (${Math.round(facts.minutes!)} min, film is ${expected} min)`, {
      provider: stream.serverId, title: title.title, id: title.id
    });
    return false;
  }

  private rememberGood(params: { id: number; type: string }, serverId?: string) {
    this.lastGood.remember(`${params.type}:${params.id}`, serverId);
  }

  // `ms` is the time from the request to a playable stream (successes only).
  private recordResult(id: string, ok: boolean, ms?: number) {
    // No network says nothing about the provider.
    if (!ok && typeof navigator !== 'undefined' && navigator.onLine === false) return;
    this.stats.record(id, ok, ms);
  }

  /** What has been learned so far, for diagnostics. */
  providerStats() {
    return this.stats.snapshot();
  }

  setSniffer(fn: Sniffer) {
    this.sniffer = fn;
  }

  constructor(withDefaults = true) {
    if (!withDefaults) {
      this.inspect = async () => ({});
      return;
    }
    // The Kunai direct-API providers answer from JSON APIs in about a second (no embed page to sniff),
    // so they lead; the four embed-based providers below are the fallback tier.
    this.register(new VidLinkExtractor());
    this.register(new VidRockExtractor());
    this.register(new RivestreamExtractor());
    this.register(new MovyExtractor());
    this.register(new MovierulzExtractor());
    this.register(new HDHub4UExtractor());
    this.register(new DesiCinemasExtractor());
    this.register(new EinthusanExtractor());
    this.register(new IsaiminiExtractor());
    this.register(new FlixeoExtractor());
    // Ported from lobster / flix-cli (both scrape FlixHQ): title search, cached id mapping, one embed per server.
    this.register(new FlixHQSource());
    // mov-cli's jellyplex idea: the viewer's own Jellyfin server, when they set one up (Settings).
    this.register(new JellyfinSource());
    // Remote config: kill switch, new hosts, API providers (see providerConfig.ts).
    subscribeProviderConfig(cfg => this.applyConfig(cfg));
  }

  private configured = new Set<string>();

  private applyConfig(cfg: ProviderConfig) {
    // Hosts and mirrors of the built-in providers.
    for (const e of this.extractors) {
      const o = cfg.providers[e.id];
      (e as { applyConfig?: (o: { mainUrl?: string; mirrors?: string[] }) => void }).applyConfig?.(o ?? {});
    }
    // Providers that exist only in the config: add new ones, drop ones that were removed.
    const wanted = new Set(cfg.apiProviders.map(a => a.id).filter(id => !this.extractors.some(e => e.id === id && !this.configured.has(id))));
    this.extractors = this.extractors.filter(e => !this.configured.has(e.id) || wanted.has(e.id));
    this.configured = new Set([...this.configured].filter(id => wanted.has(id)));
    for (const spec of cfg.apiProviders) {
      if (!wanted.has(spec.id)) continue;
      this.extractors = this.extractors.filter(e => e.id !== spec.id);
      this.extractors.push(new ApiExtractor(spec));
      this.configured.add(spec.id);
    }
  }

  register(extractor: StreamExtractor) {
    this.extractors.push(extractor);
  }

  getAllExtractors(): StreamExtractor[] {
    return this.extractors.filter(e => isProviderEnabled(e.id) && (e.available?.() ?? true));
  }

  /**
   * The planner's one number: expected ms to a playable stream for this title. What has been learned
   * (speed / success rate) once there is any, the manifest's prior until then; minus a head start when
   * the manifest says the provider suits the title, and the remote-config bias.
   */
  private plannedMs(e: StreamExtractor, title: { type: 'movie' | 'tv'; language?: string }): number {
    const base = this.stats.measured(e.id) ? this.stats.expectedMs(e.id) : priorMs(e);
    return base - (strongFor(e, title) ? PRIMARY_BIAS_MS : 0) - (getProviderOverride(e.id)?.bias ?? 0);
  }

  /** Providers best first by plannedMs; ties go to the more trusted source, then registration order. */
  private rank(list: StreamExtractor[], title: { type: 'movie' | 'tv'; language?: string }): StreamExtractor[] {
    return list
      .map((e, index) => ({ e, index, score: this.plannedMs(e, title), trust: trustRank(e) }))
      .sort((a, b) => a.score - b.score || a.trust - b.trust || a.index - b.index)
      .map(x => x.e);
  }

  private getOrderedExtractors(params: { type: 'movie' | 'tv'; language?: string; preferredServerId?: string }): StreamExtractor[] {
    const enabled = this.getAllExtractors();
    if (params.preferredServerId) {
      const preferred = enabled.find(e => e.id === params.preferredServerId);
      const rest = enabled.filter(e => e.id !== params.preferredServerId);
      return preferred ? [preferred, ...rest] : enabled;
    }
    return this.rank(enabled, params);
  }

  /** How long the cheap providers run alone (see CHEAP_HEAD_START_*). */
  private cheapHeadStartMs(cheap: StreamExtractor[], title: { type: 'movie' | 'tv'; language?: string }): number {
    const times = cheap.map(e => Math.max(0, this.plannedMs(e, title))).sort((a, b) => a - b);
    const typical = times[Math.min(1, times.length - 1)] ?? CHEAP_HEAD_START_MAX_MS;
    return Math.round(Math.min(CHEAP_HEAD_START_MAX_MS, Math.max(CHEAP_HEAD_START_MIN_MS, typical * 1.5)));
  }

  async resolveAllStreams(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    originalTitle?: string;
    year?: number;
    language?: string;
    directOnly?: boolean;
    allowSniff?: boolean;
    fresh?: boolean;
    preferredServerId?: string;
    exclude?: string[];
    // Told about every embed page a provider returned (they are never played, only sniffed or saved).
    onEmbed?: (embed: ExtractedStream) => void;
    // The lookup is speculative (nobody is waiting): sniffs yield to anything the user does.
    sniffBackground?: boolean;
    // Nobody wants the result any more: stop every extractor and sniff and return what was found.
    signal?: AbortSignal;
  }): Promise<ExtractedStream[]> {
    // Embed/iframe pages are never returned: only direct streams (or sniffed ones) can be played.
    const directOnly = true;
    const canSniff = directOnly && params.allowSniff !== false;
    const ordered = this.getOrderedExtractors(params);
    const excluded = new Set(params.exclude ?? []);
    const notExcluded = ordered.filter(e => !excluded.has(e.id));
    const usable = notExcluded.length > 0 ? notExcluded : ordered;
    // The player pages of the providers left out. Another provider handing back one of those pages
    // (a shared fallback embed) would bring the stream that just failed straight back under a new name.
    const blockedEmbeds = new Set<string>();
    if (usable === notExcluded) {
      for (const e of ordered) {
        if (!excluded.has(e.id) || !e.embedUrl) continue;
        try {
          const url = e.embedUrl(params);
          if (url) blockedEmbeds.add(url);
        } catch { /* no fixed page for this title */ }
      }
    }
    // Providers whose breaker is open sit out (a half-open one gets a single probe) - unless that would leave none.
    const healthy = usable.filter(e => this.stats.tryAcquire(e.id));
    const active = healthy.length > 0 ? healthy : usable;
    const goodId = this.lastGood.get(`${params.type}:${params.id}`);
    // The provider that worked for this title last time gets a head start rather than an exclusive
    // turn: if it still works it wins alone, and if it does not, the others are already running
    // instead of starting only after its whole attempt (extract + sniff) has timed out.
    const useLastGood = !params.fresh && !params.preferredServerId && Boolean(goodId) && active.some(e => e.id === goodId);
    // The cheap providers lead unless the user picked a server or another provider worked for this title last time.
    const cheap = active.filter(e => isCheap(e));
    const useTier = !params.preferredServerId && !useLastGood && cheap.length > 0 && cheap.length < active.length;
    const useHeadStart = useLastGood || useTier;
    // Providers strong for the title's language (they have its other language releases) start at
    // once and are waited for (see STRONG_PROVIDER_WAIT_MS), unless the user picked a server.
    const strongIds = new Set(params.preferredServerId ? [] : active.filter(e => strongForLanguage(e, params)).map(e => e.id));
    let strongPending = strongIds.size;
    const headIds = new Set([...(useLastGood ? [goodId as string] : useTier ? cheap.map(e => e.id) : []), ...(useHeadStart ? strongIds : [])]);
    const headStartMs = useLastGood ? LAST_GOOD_HEAD_START_MS : this.cheapHeadStartMs(cheap, params);
    const raceList = useHeadStart
      ? [...active.filter(e => headIds.has(e.id)), ...active.filter(e => !headIds.has(e.id))]
      : active;
    const headCount = headIds.size;

    const lookupStart = Date.now();
    const runtime: Promise<number | undefined> = params.type === 'movie'
      ? Promise.race([
          this.runtimeLookup(params.id).catch(() => undefined),
          new Promise<undefined>(r => setTimeout(() => r(undefined), RUNTIME_WAIT_MS))
        ])
      : Promise.resolve(undefined);
    return new Promise<ExtractedStream[]>(resolve => {
      const found: ExtractedStream[] = [];
      const queue: ExtractedStream[] = [];
      const queuedUrls = new Set<string>();
      let pendingExtract = raceList.length;
      // Found streams still being checked (see checkStream).
      let verifying = 0;
      let sniffRunning = 0;
      let sniffStarted = 0;
      // Hedged sniffing beyond the first UNHEDGED_SNIFFS: the next only after the running ones have
      // had their usual time (or failed), so a WebView is not burned on a likely loser.
      let lastSniffStart = 0;
      let lastSniffServer: string | undefined;
      let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
      let headStartTimer: ReturnType<typeof setTimeout> | undefined;
      let othersStarted = !useHeadStart;
      let done = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      let strongTimer: ReturnType<typeof setTimeout> | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;

      const abortController = new AbortController();
      // A speculative lookup's requests yield to the user's own (see hostLimiter.ts).
      if (params.sniffBackground) markBackground(abortController.signal);
      const external = params.signal;
      const onExternalAbort = () => finish();

      const finish = () => {
        if (done) return;
        done = true;
        external?.removeEventListener('abort', onExternalAbort);
        abortController.abort();
        if (grace) clearTimeout(grace);
        if (strongTimer) clearTimeout(strongTimer);
        if (deadline) clearTimeout(deadline);
        if (hedgeTimer) clearTimeout(hedgeTimer);
        if (headStartTimer) clearTimeout(headStartTimer);
        const sorted = [...found].sort((x, y) => {
          if (params.preferredServerId) {
            if (x.serverId === params.preferredServerId) return -1;
            if (y.serverId === params.preferredServerId) return 1;
          }
          // Language-only providers go last: they are the final fallback, not the next one.
          return Number(Boolean(x.isFallbackEmbed)) - Number(Boolean(y.isFallbackEmbed))
            || Number(this.languagesOnly(x)) - Number(this.languagesOnly(y));
        });
        this.rememberGood(params, sorted.find(x => !x.isFallbackEmbed)?.serverId);
        resolve(sorted.filter(x => !x.isFallbackEmbed));
      };

      const maybeFinish = () => {
        if (done) return;
        // While the head start runs, the providers that have not started yet still count.
        if (!othersStarted) {
          // The remembered provider came up empty (its attempt is over, nothing left to sniff): no
          // need to sit out the rest of its head start.
          const headDone = pendingExtract <= raceList.length - headCount;
          if (headDone && sniffRunning === 0 && verifying === 0 && queue.length === 0 && found.length === 0) startOthers();
          return;
        }
        if (pendingExtract === 0 && sniffRunning === 0 && verifying === 0 && (queue.length === 0 || sniffStarted >= MAX_SNIFF_ATTEMPTS)) finish();
      };

      // A stream counts once its playlist fits the film; checks run side by side with the race.
      const accept = (stream: ExtractedStream) => {
        verifying++;
        void this.checkStream(stream, runtime, params, abortController.signal).then(ok => {
          verifying--;
          if (done) return;
          if (ok) {
            found.push(stream);
            finishSoon();
          }
          maybeFinish();
        });
      };

      const finishSoon = () => {
        if (params.preferredServerId) {
          const hasPreferred = found.some(s => s.serverId === params.preferredServerId);
          if (!hasPreferred) return;
        }
        // A faster stream is here, but the provider with this title's other languages is still at
        // work: give it until STRONG_PROVIDER_WAIT_MS from the start.
        // A language-only provider's stream (Movierulz, often from its cache in a second) never ends
        // the race: the others are still looking for the main stream. maybeFinish ends it when
        // everyone is done and that stream is all there is.
        const mains = found.filter(s => !s.isFallbackEmbed && !this.languagesOnly(s));
        if (mains.length === 0) return;
        const strongHasStream = found.some(s => !s.isFallbackEmbed && strongIds.has(s.serverId ?? ''));
        if (strongPending > 0 && !strongHasStream) {
          const wait = STRONG_PROVIDER_WAIT_MS - (Date.now() - lookupStart);
          if (wait > 0) {
            if (!strongTimer) strongTimer = setTimeout(finishWhenChecked, wait);
            return;
          }
        }
        // Quality first: below 1080p, give a sharper stream a moment to arrive.
        // (A stream whose quality is not known does not hold the race up.)
        const sharp = mains.some(s => (streamHeight(s) ?? 1080) >= 1080);
        if (!grace) grace = setTimeout(finishWhenChecked, sharp ? EARLY_EXIT_GRACE_MS : QUALITY_WAIT_MS);
      };

      // Streams found but still being checked are not thrown away by the end of the race.
      let checksDeadline = 0;
      const finishWhenChecked = () => {
        if (done) return;
        if (verifying > 0) {
          checksDeadline ||= Date.now() + CHECK_WAIT_MS;
          if (Date.now() < checksDeadline) {
            grace = setTimeout(finishWhenChecked, 100);
            return;
          }
        }
        finish();
      };

      const pump = () => {
        while (!done && sniffRunning < SNIFF_CONCURRENCY && sniffStarted < MAX_SNIFF_ATTEMPTS && queue.length > 0) {
          if (sniffRunning >= UNHEDGED_SNIFFS) {
            const wait = this.stats.hedgeDelayMs(lastSniffServer ?? '') - (Date.now() - lastSniffStart);
            if (wait > 0) {
              if (!hedgeTimer) hedgeTimer = setTimeout(() => { hedgeTimer = undefined; pump(); }, wait);
              return;
            }
          }
          const embed = queue.shift()!;
          sniffRunning++;
          sniffStarted++;
          const sniffStart = Date.now();
          lastSniffStart = sniffStart;
          lastSniffServer = embed.serverId;
          this.sniffWithTimeout(embed, SNIFF_TIMEOUT_MS, abortController.signal, params.sniffBackground).then(stream => {
            sniffRunning--;
            recordTiming({ phase: 'sniff', ms: Date.now() - sniffStart, serverId: embed.serverId, titleId: params.id, title: params.title, outcome: stream ? 'sniffed' : 'failed' });
            // A speculative sniff that was refused or cut short says nothing about the provider.
            if (stream || !params.sniffBackground) this.recordResult(embed.serverId ?? 'unknown', Boolean(stream), Date.now() - lookupStart);
            if (stream) accept({ ...stream, serverId: embed.serverId, serverName: embed.serverName });
            pump();
            maybeFinish();
          });
        }
      };

      const enqueue = (embed: ExtractedStream) => {
        if (done || queuedUrls.has(embed.url)) return;
        queuedUrls.add(embed.url);
        if (embed.serverId && embed.serverId === goodId) { queue.unshift(embed); return; }
        // Best provider first (by learned speed and reliability); ties keep arrival order.
        const score = this.stats.expectedMs(embed.serverId ?? '');
        let at = queue.length;
        while (at > 0 && this.stats.expectedMs(queue[at - 1].serverId ?? '') > score && queue[at - 1].serverId !== goodId) at--;
        queue.splice(at, 0, embed);
      };

      // Queues the embed page right away when the provider can name it without a request.
      const queueEarly = (extractor: StreamExtractor) => {
        if (!canSniff || !extractor.embedUrl) return;
        const url = (() => { try { return extractor.embedUrl!(params); } catch { return null; } })();
        if (!url) return;
        const early: ExtractedStream = { url, format: 'hls', isFallbackEmbed: true, serverId: extractor.id, serverName: extractor.name };
        params.onEmbed?.(early);
        enqueue(early);
      };

      const run = (extractor: StreamExtractor) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const limitMs = manifestOf(extractor).costHint === 'multi-hop' ? MULTI_HOP_TIMEOUT_MS : PROVIDER_TIMEOUT_MS;
        const timeout = new Promise<null>(r => { timer = setTimeout(() => r(null), limitMs); });

        const startedAt = Date.now();
        const callParams: ExtractParams = { ...params, signal: abortController.signal };
        // Providers that report every server/lane they found hand all of them over (alternates for
        // the player); the rest give their single best.
        const attempt = (async (): Promise<ExtractedStream[]> => {
          if (extractor.extractAll) return extractor.extractAll(callParams);
          const one = await extractor.extract(callParams);
          return one ? [one] : [];
        })();
        Promise.race([attempt, timeout])
          .catch(err => {
            // Thrown, not just "nothing found": a broken provider or site. Cancelled ones (another
            // provider already won) are not failures.
            // Rate limits (HTTP 429) are the site asking for a pause, which the host limiter gives it.
            const expected = err instanceof Error && (/abort/i.test(err.name + err.message) || /\b429\b|rate limited/i.test(err.message));
            if (!abortController.signal.aborted && !expected) {
              reportError('provider', err, { provider: extractor.id, title: params.title, id: params.id, type: params.type, season: params.season, episode: params.episode, ms: Date.now() - startedAt });
            }
            return null;
          })
          .then(result => {
            if (timer) clearTimeout(timer);
            const elapsed = Date.now() - startedAt;
            const streams = (result ?? []).filter(st => st && st.url && st.url.trim().length > 0);
            const directs = streams.filter(st => !st.isFallbackEmbed);
            recordTiming({
              phase: 'extract', ms: elapsed, serverId: extractor.id, titleId: params.id, title: params.title,
              outcome: streams.length === 0 ? (elapsed >= limitMs - 50 ? 'timeout' : 'none') : directs.length > 0 ? 'direct' : 'embed'
            });
            if (done) return;

            if (streams.length === 0) {
              this.recordResult(extractor.id, false);
              return;
            }
            if (directs.length > 0) this.recordResult(extractor.id, true, elapsed);
            const ttl = manifestOf(extractor).linkTtlMs;
            for (const stream of streams) {
              const tagged = {
                ...stream,
                serverId: stream.serverId || extractor.id,
                serverName: stream.serverName || extractor.name,
                ...(ttl !== undefined && stream.revalidateAfterMs === undefined ? { revalidateAfterMs: ttl } : {})
              };
              if (!tagged.isFallbackEmbed) {
                accept(tagged);
              } else if (!blockedEmbeds.has(tagged.url)) {
                // An embed page is neither a success nor a failure until it is sniffed (or cannot be here:
                // a background prefetch, or the web).
                params.onEmbed?.(tagged);
                if (canSniff) enqueue(tagged);
              }
            }
          })
          .finally(() => {
            pendingExtract--;
            if (strongIds.has(extractor.id)) {
              strongPending--;
              // It answered (with or without a stream): nothing more to wait for if one is in hand.
              if (found.some(s => !s.isFallbackEmbed)) finishSoon();
            }
            pump();
            maybeFinish();
          });
      };

      // Everyone else: after the head start, or as soon as the remembered provider has nothing.
      const startOthers = () => {
        if (othersStarted || done) return;
        othersStarted = true;
        if (headStartTimer) clearTimeout(headStartTimer);
        const others = raceList.slice(headCount);
        // Every early embed is queued before any sniff starts, so the best-ranked ones get the WebViews.
        others.forEach(queueEarly);
        pump();
        others.forEach(run);
        maybeFinish();
      };

      deadline = setTimeout(finish, RESOLVE_DEADLINE_MS);
      if (raceList.length === 0 || external?.aborted) { finish(); return; }
      external?.addEventListener('abort', onExternalAbort, { once: true });

      if (useHeadStart) {
        const head = raceList.slice(0, headCount);
        head.forEach(queueEarly);
        pump();
        head.forEach(run);
        headStartTimer = setTimeout(startOthers, headStartMs);
      } else {
        raceList.forEach(queueEarly);
        pump();
        raceList.forEach(run);
      }
    });
  }

  /** Turns a saved embed page into a direct stream with the native sniffer, or null. */
  sniffEmbed(embed: ExtractedStream, ms = SNIFF_TIMEOUT_MS): Promise<ExtractedStream | null> {
    return this.sniffWithTimeout(embed, ms);
  }

  private async sniffWithTimeout(embed: ExtractedStream, ms: number, signal?: AbortSignal, background?: boolean): Promise<ExtractedStream | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stream = await Promise.race([
        (async () => this.sniffer(embed, signal, background))(),
        new Promise<null>(r => { timer = setTimeout(() => r(null), ms); })
      ]);
      return stream && stream.url ? stream : null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async resolveBestStream(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    language?: string;
    languageMode?: string;
    preferredServerId?: string;
    directOnly?: boolean;
  }, precomputed?: ExtractedStream[]): Promise<ExtractedStream | null> {
    const directStreams = (precomputed ?? await this.resolveAllStreams(params)).filter(s => !s.isFallbackEmbed);
    const all = filterBestPrintStreams(directStreams);
    if (all.length === 0) return null;

    if (params.preferredServerId) {
      const preferred = all.find(s => s.serverId === params.preferredServerId);
      if (preferred) return preferred;
    }

    // Language-only providers (Movierulz on English titles) do not give the main stream when anyone else has the title:
    // their releases are often lower quality / regional dubs. Their languages are added to the one picked.
    const main = all.filter(s => !this.languagesOnly(s));
    const pool = main.length ? main : all;
    const best = this.pickMain(pool, params);
    if (!best) return null;
    // Every other stream with a language list lends the languages the main one lacks; the
    // language-only providers' come last.
    const extras = all.filter(s => s !== best && (s.audios?.length ?? 0) > 0)
      .sort((a, b) => Number(this.languagesOnly(a)) - Number(this.languagesOnly(b)));
    return extras.length ? withExtraLanguages(best, extras, params.language) : best;
  }

  /**
   * Quality first: the sharpest stream wins; within the same quality the one expected to start
   * sooner, with a small edge for the provider that worked last time and for a stream that has the
   * title's own language among its audio tracks.
   */
  private pickMain(all: ExtractedStream[], params: { id: number; type: 'movie' | 'tv'; language?: string }): ExtractedStream | null {
    const wantedCode = (params.language ?? '').toLowerCase().split('-')[0];
    const wanted = LANGUAGE_NAMES[wantedCode] ?? '';
    const isEnglishTitle = !wantedCode || wantedCode === 'en';
    const goodId = this.lastGood.get(`${params.type}:${params.id}`);
    const byId = new Map(this.extractors.map(e => [e.id, e]));

    const score = (s: ExtractedStream) => {
      const e = s.serverId ? byId.get(s.serverId) : undefined;
      const speed = e ? this.plannedMs(e, params) : QUALITY_TIER_MS / 2;
      const isRegionalScraper = Boolean(e && REGIONAL_PROVIDER_IDS.has(e.id));

      let langBonus = 0;
      if (isEnglishTitle) {
        // For English titles, non-regional extractors naturally provide English
        if (!isRegionalScraper) {
          langBonus = 5_000_000;
        }
      } else if (wanted) {
        const sLang = (s.audios?.[0]?.language || s.audios?.[0]?.label || '').toLowerCase();
        const matchesLang = (
          sLang === wanted.toLowerCase() ||
          s.audios?.some(a => (a.language || a.label || '').toLowerCase() === wanted.toLowerCase())
        );
        if (matchesLang) {
          langBonus = 5_000_000;
        }
      }

      // Heavy penalty if title original language is English ('en') but stream comes from an Indian regional scraper
      const regionalPenalty = isEnglishTitle && isRegionalScraper ? 10_000_000 : 0;

      const remembered = goodId && s.serverId === goodId ? TIE_BONUS_MS : 0;
      return qualityTier(s) * QUALITY_TIER_MS + Math.min(Math.max(speed, 0), QUALITY_TIER_MS - 1) - langBonus + regionalPenalty - remembered;
    };
    return [...all].sort((a, b) => score(a) - score(b))[0] ?? null;
  }
}

function streamHeight(s: ExtractedStream): number | undefined {
  return s.height ?? heightOf(s.quality) ?? heightOf(s.qualities?.map(q => heightOf(q.quality) ?? 0).sort((a, b) => b - a)[0])
    // A rendition playlist named after its height (".../720/index.m3u8", "..._1080p.m3u8").
    ?? heightOf(s.url.match(/[/_-](2160|1440|1080|720|576|480|360)p?(?=[/_.-])/i)?.[1]);
}

/** 0 = 1080p or better, 1 = 720p (or not known), 2 = 480p, 3 = less. */
function qualityTier(s: ExtractedStream): number {
  const h = streamHeight(s);
  if (!h) return 1;
  return h >= 1080 ? 0 : h >= 720 ? 1 : h >= 480 ? 2 : 3;
}

/**
 * The main stream with the languages it lacks added from other providers' streams. Each added
 * language is a whole stream of its own (the player switches to it at the same position) with its own
 * request headers; a language the main stream already has is not added again.
 */
export function withExtraLanguages(
  main: ExtractedStream,
  extras: ExtractedStream[],
  titleLanguage?: string
): ExtractedStream {
  const code = (titleLanguage ?? '').toLowerCase().split('-')[0];
  const nativeLang = LANGUAGE_NAMES[code];
  const isRegional = Boolean(main.serverId && REGIONAL_PROVIDER_IDS.has(main.serverId));

  let defaultLabel = 'Default';
  let defaultLang = '';

  if (code === 'en') {
    defaultLabel = isRegional ? 'Hindi (Dubbed)' : 'English';
    defaultLang = isRegional ? 'Hindi' : 'English';
  } else if (isRegional && nativeLang) {
    defaultLabel = nativeLang;
    defaultLang = nativeLang;
  }

  const own = main.audios?.length
    ? main.audios
    : [{ label: defaultLabel, language: defaultLang, url: main.url }];
  const audios = [...own];
  const has = (name: string) => audios.some(a => a.language.toLowerCase() === name.toLowerCase() || a.label.toLowerCase() === name.toLowerCase());
  for (const extra of extras) {
    const list = extra.audios?.length ? extra.audios : [];
    for (const a of list) {
      if (!a.language || has(a.language)) continue;
      audios.push({ ...a, headers: a.headers ?? extra.headers, otherSource: true });
    }
  }
  return audios.length > own.length ? { ...main, audios } : main;
}

export const extractorRegistry = new ExtractorRegistry();
