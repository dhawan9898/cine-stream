// extractorRegistry.ts - Central registry for real title-specific stream extractors
import type { StreamExtractor, ExtractedStream } from './types.ts';
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

const MAX_SNIFF_ATTEMPTS = 4;
const SNIFF_CONCURRENCY = 2;
const PROVIDER_TIMEOUT_MS = 6000;
const SNIFF_TIMEOUT_MS = 12000;
const RESOLVE_DEADLINE_MS = 20000;
const EARLY_EXIT_GRACE_MS = 250;
const HEALTH_KEY = 'cinestream_provider_stats_v2';
const FAILS_BEFORE_COOLDOWN = 3;
const COOLDOWN_MS = 10 * 60 * 1000;

/** Head start (ms of expected time) given to the provider that suits the title. */
const PRIMARY_BIAS_MS = 1500;
const LAST_GOOD_KEY = 'cinestream_last_good_v1';
const LAST_GOOD_MAX = 300;
const LAST_GOOD_TIMEOUT_MS = 3500;
const LAST_GOOD_SNIFF_TIMEOUT_MS = 8000;

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
    this.register(new MovierulzExtractor());
    this.register(new FlixeoExtractor());
    this.register(new VegaExtractor());
    this.register(new CineHypeExtractor());
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
    return this.extractors.filter(e => isProviderEnabled(e.id));
  }

  private isRegionalTitle(title?: string, language?: string, languageMode?: string): boolean {
    const titleLower = (title || '').toLowerCase();
    const hasRegionalLang =
      Boolean(language && ['te', 'hi', 'ta', 'ml', 'kn', 'pa', 'bn'].includes(language.toLowerCase())) ||
      Boolean(languageMode && ['hindi', 'telugu', 'tamil', 'multi'].includes(languageMode.toLowerCase()));
    const hasRegionalUnicode = /[\u0C00-\u0C7F\u0900-\u097F\u0B80-\u0BFF\u0D00-\u0D7F\u0C80-\u0CFF]/.test(title || '');
    const hasRegionalKeywords = /\b(thella|tella|kaagitham|kagitam|kaagidham|pushpa|devara|kalki|salaar|saripodhaa|kanguva|hanuman|tillu|guntur|bramayugam|avesham|baskhar|amaran|movierulz|telugu|hindi|tamil|malayalam|kannada)\b/i.test(titleLower);
    return hasRegionalLang || hasRegionalUnicode || hasRegionalKeywords;
  }

  private getOrderedExtractors(type: 'movie' | 'tv', preferredServerId?: string, isRegional = false): StreamExtractor[] {
    if (preferredServerId) {
      const enabled = this.extractors.filter(e => isProviderEnabled(e.id));
      const preferred = enabled.find(e => e.id === preferredServerId);
      const rest = enabled.filter(e => e.id !== preferredServerId);
      return preferred ? [preferred, ...rest] : enabled;
    }
    const primaryId = isRegional
      ? 'movierulz'
      : (type === 'movie' ? 'vega' : 'flixeo');
    // Fastest and most reliable first, learned from real lookups. The title's natural
    // provider gets a head start so it is still preferred while nothing is known.
    return this.stats.rank(
      this.extractors.filter(e => isProviderEnabled(e.id)),
      id => (id === primaryId ? PRIMARY_BIAS_MS : 0) + (getProviderOverride(id)?.bias ?? 0)
    );
  }

  async resolveAllStreams(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
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
  }): Promise<ExtractedStream[]> {
    // Embed/iframe pages are never returned: only direct streams (or sniffed ones) can be played.
    const directOnly = true;
    const canSniff = directOnly && params.allowSniff !== false;
    const isRegional = this.isRegionalTitle(params.title, params.language);
    const ordered = this.getOrderedExtractors(params.type, params.preferredServerId, isRegional);
    const excluded = new Set(params.exclude ?? []);
    const notExcluded = ordered.filter(e => !excluded.has(e.id));
    const usable = notExcluded.length > 0 ? notExcluded : ordered;
    // Providers whose breaker is open sit out (a half-open one gets a single probe) - unless that would leave none.
    const healthy = usable.filter(e => this.stats.tryAcquire(e.id));
    const active = healthy.length > 0 ? healthy : usable;
    const goodId = this.lastGood.get(`${params.type}:${params.id}`);

    // Shortcut: provider that worked for this title last time (directOnly native playback)
    if (!params.fresh && !params.preferredServerId && directOnly) {
      const good = goodId ? active.find(e => e.id === goodId) : undefined;
      if (good) {
        const viaGood = await this.tryProvider(good, params, canSniff);
        if (viaGood) {
          this.rememberGood(params, good.id);
          return [viaGood];
        }
      }
    }

    const race = active.filter(e => !(e.id === goodId && !params.fresh && !params.preferredServerId && directOnly));
    const raceList = race.length > 0 ? race : active;

    const lookupStart = Date.now();
    return new Promise<ExtractedStream[]>(resolve => {
      const found: ExtractedStream[] = [];
      const queue: ExtractedStream[] = [];
      const queuedUrls = new Set<string>();
      let pendingExtract = raceList.length;
      let sniffRunning = 0;
      let sniffStarted = 0;
      // Hedged sniffing: the best embed starts at once; the next only after the first has had
      // its usual time (or failed), so one WebView is not burned on a likely loser.
      let lastSniffStart = 0;
      let lastSniffServer: string | undefined;
      let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
      let done = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;

      const abortController = new AbortController();

      const finish = () => {
        if (done) return;
        done = true;
        abortController.abort();
        if (grace) clearTimeout(grace);
        if (deadline) clearTimeout(deadline);
        if (hedgeTimer) clearTimeout(hedgeTimer);
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
          if (sniffRunning > 0) {
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
        if (queuedUrls.has(embed.url)) return;
        queuedUrls.add(embed.url);
        if (embed.serverId && embed.serverId === goodId) { queue.unshift(embed); return; }
        // Best provider first (by learned speed and reliability); ties keep arrival order.
        const score = this.stats.expectedMs(embed.serverId ?? '');
        let at = queue.length;
        while (at > 0 && this.stats.expectedMs(queue[at - 1].serverId ?? '') > score && queue[at - 1].serverId !== goodId) at--;
        queue.splice(at, 0, embed);
      };

      deadline = setTimeout(finish, RESOLVE_DEADLINE_MS);
      if (raceList.length === 0) { finish(); return; }

      // Concurrent parallel execution across extractors
      raceList.forEach(extractor => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<null>(r => { timer = setTimeout(() => r(null), PROVIDER_TIMEOUT_MS); });

        const startedAt = Date.now();
        const attempt = (async () => extractor.extract({ ...params, signal: abortController.signal }))();
        Promise.race([attempt, timeout])
          .catch(() => null)
          .then(stream => {
            if (timer) clearTimeout(timer);
            const elapsed = Date.now() - startedAt;
            recordTiming({
              phase: 'extract', ms: elapsed, serverId: extractor.id, titleId: params.id, title: params.title,
              outcome: !stream || !stream.url ? (elapsed >= PROVIDER_TIMEOUT_MS - 50 ? 'timeout' : 'none') : stream.isFallbackEmbed ? 'embed' : 'direct'
            });
            if (done) return;

            // Stream health check: verify valid URL and stream presence
            if (stream && stream.url && stream.url.trim().length > 0) {
              const tagged = {
                ...stream,
                serverId: stream.serverId || extractor.id,
                serverName: stream.serverName || extractor.name
              };
              if (!tagged.isFallbackEmbed) {
                this.recordResult(extractor.id, true, elapsed);
                found.push(tagged);
                finishSoon();
              } else {
                params.onEmbed?.(tagged);
                if (canSniff) enqueue(tagged);
              }
              // else: an embed page that cannot be sniffed here (a background prefetch, or the web).
              // It says nothing about the provider's health, so it is neither a success nor a failure.
            } else {
              this.recordResult(extractor.id, false);
            }
          })
          .finally(() => {
            pendingExtract--;
            pump();
            maybeFinish();
          });
      });
    });
  }

  private async tryProvider(
    extractor: StreamExtractor,
    params: Parameters<StreamExtractor['extract']>[0] & { onEmbed?: (embed: ExtractedStream) => void; sniffBackground?: boolean },
    canSniff: boolean
  ): Promise<ExtractedStream | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    try {
      const stream = await Promise.race([
        (async () => extractor.extract(params))(),
        new Promise<null>(r => { timer = setTimeout(() => r(null), LAST_GOOD_TIMEOUT_MS); })
      ]);
      const elapsed = Date.now() - startedAt;
      recordTiming({
        phase: 'extract', ms: elapsed, serverId: extractor.id, titleId: params.id, title: params.title,
        outcome: !stream || !stream.url ? (elapsed >= LAST_GOOD_TIMEOUT_MS - 50 ? 'timeout' : 'none') : stream.isFallbackEmbed ? 'embed' : 'direct'
      });
      if (!stream || !stream.url) { this.recordResult(extractor.id, false); return null; }
      const tagged = { ...stream, serverId: stream.serverId || extractor.id, serverName: stream.serverName || extractor.name };
      if (!tagged.isFallbackEmbed) { this.recordResult(extractor.id, true, Date.now() - startedAt); return tagged; }
      params.onEmbed?.(tagged);
      if (!canSniff) return null; // cannot sniff here: says nothing about the provider's health
      const sniffStart = Date.now();
      const sniffed = await this.sniffWithTimeout(tagged, LAST_GOOD_SNIFF_TIMEOUT_MS, undefined, params.sniffBackground);
      recordTiming({ phase: 'sniff', ms: Date.now() - sniffStart, serverId: extractor.id, titleId: params.id, title: params.title, outcome: sniffed ? 'sniffed' : 'failed' });
      if (sniffed || !params.sniffBackground) this.recordResult(extractor.id, Boolean(sniffed), Date.now() - startedAt);
      return sniffed ? { ...sniffed, serverId: tagged.serverId, serverName: tagged.serverName } : null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
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

    const isRegional = this.isRegionalTitle(params.title, params.language, params.languageMode);
    const primaryId = isRegional
      ? 'movierulz'
      : (params.type === 'movie' ? 'vega' : 'flixeo');

    // 1. Primary provider direct stream
    const primaryDirect = all.find(s => !s.isFallbackEmbed && s.serverId === primaryId);
    if (primaryDirect) return primaryDirect;

    // 2. Any direct media stream across providers
    const directStream = all.find(s => !s.isFallbackEmbed);
    if (directStream) return directStream;

    // 3. Primary provider stream (Vega / Flixeo for general, Movierulz for Regional)
    const primaryStream = all.find(s => s.serverId === primaryId);
    if (primaryStream) return primaryStream;

    // 4. Clean stream preference: Vega -> Flixeo -> CineHype -> Movierulz
    const cleanStream =
      all.find(s => s.serverId === 'vega') ||
      all.find(s => s.serverId === 'flixeo') ||
      all.find(s => s.serverId === 'cinehype') ||
      all.find(s => s.serverId === 'movierulz');

    return cleanStream ?? all[0] ?? null;
  }
}

export const extractorRegistry = new ExtractorRegistry();
