// extractorRegistry.ts - Central registry for real title-specific stream extractors
import type { StreamExtractor, ExtractedStream, ExtractParams } from './types.ts';
import { isCheap, manifestOf, priorMs, strongFor, trustRank } from './manifest.ts';
import { markBackground } from './hostLimiter.ts';
import { FlixHQSource } from '../sources/flixhq.ts';
import { JellyfinSource } from '../sources/jellyfin.ts';
import { sniffDirectStream } from '../webSniffer.ts';
import { LastGoodStore } from 'streamkit/providers/health.ts';
import { ProviderStats } from './providerStats.ts';
import { recordTiming } from '../streamTimings.ts';
import { getProviderOverride, isProviderEnabled, subscribeProviderConfig, type ProviderConfig } from '../providerConfig.ts';
import { ApiExtractor } from './apiExtractor.ts';
import { VegaExtractor } from './vegaExtractor.ts';
import { FlixeoExtractor } from './flixeoExtractor.ts';
import { CineHypeExtractor } from './cinehypeExtractor.ts';
import { MovierulzExtractor } from './movierulzExtractor.ts';
import { VidLinkExtractor } from './vidlinkExtractor.ts';
import { VidRockExtractor } from './vidrockExtractor.ts';
import { RivestreamExtractor } from './rivestreamExtractor.ts';
import { MovyExtractor } from './movyExtractor.ts';

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
const HEALTH_KEY = 'cinestream_provider_stats_v2';
const FAILS_BEFORE_COOLDOWN = 3;
const COOLDOWN_MS = 10 * 60 * 1000;

/** Head start (ms of expected time) for a provider whose manifest says it suits the title (kind/language). */
const PRIMARY_BIAS_MS = 1500;
const LAST_GOOD_KEY = 'cinestream_last_good_v1';
const LAST_GOOD_MAX = 300;

type Sniffer = (embed: ExtractedStream, signal?: AbortSignal, background?: boolean) => Promise<ExtractedStream | null>;

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
    if (!withDefaults) return;
    // The Kunai direct-API providers answer from JSON APIs in about a second (no embed page to sniff),
    // so they lead; the four embed-based providers below are the fallback tier.
    this.register(new VidLinkExtractor());
    this.register(new VidRockExtractor());
    this.register(new RivestreamExtractor());
    this.register(new MovyExtractor());
    this.register(new MovierulzExtractor());
    this.register(new FlixeoExtractor());
    this.register(new VegaExtractor());
    this.register(new CineHypeExtractor());
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
    const headIds = new Set(useLastGood ? [goodId as string] : useTier ? cheap.map(e => e.id) : []);
    const headStartMs = useLastGood ? LAST_GOOD_HEAD_START_MS : this.cheapHeadStartMs(cheap, params);
    const raceList = useHeadStart
      ? [...active.filter(e => headIds.has(e.id)), ...active.filter(e => !headIds.has(e.id))]
      : active;
    const headCount = headIds.size;

    const lookupStart = Date.now();
    return new Promise<ExtractedStream[]>(resolve => {
      const found: ExtractedStream[] = [];
      const queue: ExtractedStream[] = [];
      const queuedUrls = new Set<string>();
      let pendingExtract = raceList.length;
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
        if (deadline) clearTimeout(deadline);
        if (hedgeTimer) clearTimeout(hedgeTimer);
        if (headStartTimer) clearTimeout(headStartTimer);
        const sorted = [...found].sort((x, y) => {
          if (params.preferredServerId) {
            if (x.serverId === params.preferredServerId) return -1;
            if (y.serverId === params.preferredServerId) return 1;
          }
          return Number(Boolean(x.isFallbackEmbed)) - Number(Boolean(y.isFallbackEmbed));
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
          if (headDone && sniffRunning === 0 && queue.length === 0 && found.length === 0) startOthers();
          return;
        }
        if (pendingExtract === 0 && sniffRunning === 0 && (queue.length === 0 || sniffStarted >= MAX_SNIFF_ATTEMPTS)) finish();
      };

      const finishSoon = () => {
        if (params.preferredServerId) {
          const hasPreferred = found.some(s => s.serverId === params.preferredServerId);
          if (!hasPreferred) return;
        }
        if (!grace) grace = setTimeout(finish, EARLY_EXIT_GRACE_MS);
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
            if (stream) {
              found.push({ ...stream, serverId: embed.serverId, serverName: embed.serverName });
              finishSoon();
            }
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
          .catch(() => null)
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
                found.push(tagged);
              } else if (!blockedEmbeds.has(tagged.url)) {
                // An embed page is neither a success nor a failure until it is sniffed (or cannot be here:
                // a background prefetch, or the web).
                params.onEmbed?.(tagged);
                if (canSniff) enqueue(tagged);
              }
            }
            if (directs.length > 0) finishSoon();
          })
          .finally(() => {
            pendingExtract--;
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
    const all = (precomputed ?? await this.resolveAllStreams(params)).filter(s => !s.isFallbackEmbed);
    if (all.length === 0) return null;

    if (params.preferredServerId) {
      const preferred = all.find(s => s.serverId === params.preferredServerId);
      if (preferred) return preferred;
    }

    const goodId = this.lastGood.get(`${params.type}:${params.id}`);
    if (goodId) {
      const goodStream = all.find(s => s.serverId === goodId);
      if (goodStream) return goodStream;
    }

    // The same ranking that ordered the race picks the stream (no separate hard-coded order).
    const byId = new Map(this.extractors.map(e => [e.id, e]));
    const score = (s: ExtractedStream) => {
      const e = s.serverId ? byId.get(s.serverId) : undefined;
      return e ? this.plannedMs(e, params) : Number.MAX_SAFE_INTEGER;
    };
    return [...all].sort((a, b) => score(a) - score(b))[0] ?? null;
  }
}

export const extractorRegistry = new ExtractorRegistry();
