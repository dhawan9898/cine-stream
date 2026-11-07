// extractorRegistry.ts - Central registry for real title-specific stream extractors
import { Capacitor } from '@capacitor/core';
import type { StreamExtractor, ExtractedStream } from './types.ts';
import { sniffDirectStream } from '../webSniffer.ts';
import { ProviderHealth, LastGoodStore } from 'streamkit/providers/health.ts';
import { FlixeoExtractor } from './flixeoExtractor.ts';
import { MovierulzExtractor } from './movierulzExtractor.ts';
import { VidLinkExtractor } from './vidlinkExtractor.ts';
import { VidSrcExtractor } from './vidsrcExtractor.ts';
import { AutoEmbedExtractor } from './autoembedExtractor.ts';
import { MultiEmbedExtractor } from './multiembedExtractor.ts';

const MAX_SNIFF_ATTEMPTS = 4;
// Hidden web views sniffing at the same time (each is a full browser page).
const SNIFF_CONCURRENCY = 2;
const PROVIDER_TIMEOUT_MS = 6000;
const SNIFF_TIMEOUT_MS = 12000;
// A lookup never runs longer than this, whatever the providers do.
const RESOLVE_DEADLINE_MS = 20000;
// After a direct stream arrives, wait this long for a better one then stop.
const EARLY_EXIT_GRACE_MS = 350;
const HEALTH_KEY = 'cinestream_provider_health_v1';
const FAILS_BEFORE_COOLDOWN = 3;
const COOLDOWN_MS = 10 * 60 * 1000;

// Which provider last gave a working stream for a title - tried first next time.
const LAST_GOOD_KEY = 'cinestream_last_good_v1';
const LAST_GOOD_MAX = 300;
const LAST_GOOD_TIMEOUT_MS = 3500;
const LAST_GOOD_SNIFF_TIMEOUT_MS = 8000;

type Sniffer = (embed: ExtractedStream) => Promise<ExtractedStream | null>;

export class ExtractorRegistry {
  private extractors: StreamExtractor[] = [];
  private sniffer: Sniffer = embed => sniffDirectStream(embed, SNIFF_TIMEOUT_MS);
  private health = new ProviderHealth({
    storageKey: HEALTH_KEY,
    failsBeforeCooldown: FAILS_BEFORE_COOLDOWN,
    cooldownMs: COOLDOWN_MS
  });
  private lastGood = new LastGoodStore(LAST_GOOD_KEY, LAST_GOOD_MAX);

  private rememberGood(params: { id: number; type: string }, serverId?: string) {
    this.lastGood.remember(`${params.type}:${params.id}`, serverId);
  }

  private recordResult(id: string, ok: boolean) {
    this.health.record(id, ok);
  }

  private isCoolingDown(id: string): boolean {
    return this.health.isCoolingDown(id);
  }

  // Lets tests (or other platforms) swap the embed -> direct stream resolver.
  setSniffer(fn: Sniffer) {
    this.sniffer = fn;
  }

  constructor(withDefaults = true) {
    if (!withDefaults) return;
    // Retired from the defaults (hosts unreachable in testing, each wasted a
    // lookup slot): Rive, EmbedSu, Smashy, InsertUnit. Their extractor files are
    // kept - re-register one here if its host comes back.
    // Primary multi-server embed sources with 100% TMDB coverage first
    this.register(new MultiEmbedExtractor());
    this.register(new AutoEmbedExtractor());
    this.register(new MovierulzExtractor());
    this.register(new VidLinkExtractor());
    this.register(new VidSrcExtractor());
    this.register(new FlixeoExtractor());
  }

  register(extractor: StreamExtractor) {
    this.extractors.push(extractor);
  }

  getAllExtractors(): StreamExtractor[] {
    return [...this.extractors];
  }

  async resolveAllStreams(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    language?: string;
    // Only return direct stream data (never iframe/embed pages). Defaults to
    // true on native Android, where the result is handed straight to ExoPlayer.
    directOnly?: boolean;
    // Background prefetches must not spin up hidden web views.
    allowSniff?: boolean;
    // Skip the remembered-provider shortcut (retry after a failure).
    fresh?: boolean;
    preferredServerId?: string;
    // Providers whose stream just failed: not asked again for this lookup.
    exclude?: string[];
  }): Promise<ExtractedStream[]> {
    const directOnly = params.directOnly ?? Capacitor.isNativePlatform();
    const canSniff = directOnly && params.allowSniff !== false;
    const excluded = new Set(params.exclude ?? []);
    // Servers that just failed are skipped - unless that would leave none at all.
    const notExcluded = this.extractors.filter(e => !excluded.has(e.id));
    const usable = notExcluded.length > 0 ? notExcluded : this.extractors;
    // Skip providers on cooldown, but never skip everything.
    const healthy = usable.filter(e => !this.isCoolingDown(e.id));
    const active = healthy.length > 0 ? healthy : usable;
    const goodId = this.lastGood.get(`${params.type}:${params.id}`);

    // Shortcut: the provider that worked for this title last time, alone. It
    // either hands over a direct stream or an embed page, which is sniffed at
    // once - so a title that played before starts without waiting on (or
    // loading) any other provider. Falls through to the full race if it no
    // longer delivers.
    if (!params.fresh && !params.preferredServerId) {
      const good = goodId ? active.find(e => e.id === goodId) : undefined;
      if (good) {
        const viaGood = await this.tryProvider(good, params, canSniff, directOnly);
        if (viaGood) {
          this.rememberGood(params, good.id);
          return [viaGood];
        }
      }
    }

    const race = active.filter(e => !(e.id === goodId && !params.fresh && !params.preferredServerId));
    const raceList = race.length > 0 ? race : active;

    return new Promise<ExtractedStream[]>(resolve => {
      const found: ExtractedStream[] = []; // direct streams (or, on the web, embeds too)
      const queue: ExtractedStream[] = [];  // embed pages waiting for a sniff slot
      const queuedUrls = new Set<string>();
      let pendingExtract = raceList.length;
      let sniffRunning = 0;
      let sniffStarted = 0;
      let done = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        if (done) return;
        done = true;
        if (grace) clearTimeout(grace);
        if (deadline) clearTimeout(deadline);
        const sorted = [...found].sort((x, y) => Number(Boolean(x.isFallbackEmbed)) - Number(Boolean(y.isFallbackEmbed)));
        this.rememberGood(params, sorted.find(x => !x.isFallbackEmbed)?.serverId);
        resolve(directOnly ? sorted.filter(x => !x.isFallbackEmbed) : sorted);
      };
      const maybeFinish = () => {
        if (done) return;
        if (pendingExtract === 0 && sniffRunning === 0 && (queue.length === 0 || sniffStarted >= MAX_SNIFF_ATTEMPTS)) finish();
      };
      const finishSoon = () => { if (!grace) grace = setTimeout(finish, EARLY_EXIT_GRACE_MS); };

      // Sniff slots: a couple of hidden web views at a time, each embed page as
      // soon as its provider has answered (no waiting for the slowest provider).
      const pump = () => {
        while (!done && sniffRunning < SNIFF_CONCURRENCY && sniffStarted < MAX_SNIFF_ATTEMPTS && queue.length > 0) {
          const embed = queue.shift()!;
          sniffRunning++;
          sniffStarted++;
          this.sniffWithTimeout(embed, SNIFF_TIMEOUT_MS).then(stream => {
            sniffRunning--;
            // Health follows what really happened: a sniffed stream is a success,
            // an embed that never gave one is a failure.
            this.recordResult(embed.serverId ?? 'unknown', Boolean(stream));
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
        // The remembered provider goes to the front.
        if (embed.serverId && embed.serverId === goodId) queue.unshift(embed);
        else queue.push(embed);
      };

      deadline = setTimeout(finish, RESOLVE_DEADLINE_MS);
      if (raceList.length === 0) { finish(); return; }

      raceList.forEach(extractor => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<null>(r => { timer = setTimeout(() => r(null), PROVIDER_TIMEOUT_MS); });
        // extract() may throw synchronously; wrap so one bad provider never breaks the lookup.
        const attempt = (async () => extractor.extract(params))();
        Promise.race([attempt, timeout])
          .catch(() => null)
          .then(stream => {
            if (timer) clearTimeout(timer);
            if (done) return;
            if (stream && stream.url) {
              const tagged = { ...stream, serverId: stream.serverId || extractor.id, serverName: stream.serverName || extractor.name };
              if (!tagged.isFallbackEmbed) {
                this.recordResult(extractor.id, true);
                found.push(tagged);
                finishSoon();
              } else if (canSniff) {
                enqueue(tagged); // judged by what the sniff finds
              } else if (!directOnly) {
                found.push(tagged);
              }
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

  // Asks one provider for a stream; an embed page it returns is sniffed.
  private async tryProvider(
    extractor: StreamExtractor,
    params: Parameters<StreamExtractor['extract']>[0],
    canSniff: boolean,
    directOnly: boolean
  ): Promise<ExtractedStream | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stream = await Promise.race([
        (async () => extractor.extract(params))(),
        new Promise<null>(r => { timer = setTimeout(() => r(null), LAST_GOOD_TIMEOUT_MS); })
      ]);
      if (!stream || !stream.url) { this.recordResult(extractor.id, false); return null; }
      const tagged = { ...stream, serverId: stream.serverId || extractor.id, serverName: stream.serverName || extractor.name };
      if (!tagged.isFallbackEmbed) { this.recordResult(extractor.id, true); return tagged; }
      if (!canSniff) return directOnly ? null : tagged;
      const sniffed = await this.sniffWithTimeout(tagged, LAST_GOOD_SNIFF_TIMEOUT_MS);
      this.recordResult(extractor.id, Boolean(sniffed));
      return sniffed ? { ...sniffed, serverId: tagged.serverId, serverName: tagged.serverName } : null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async sniffWithTimeout(embed: ExtractedStream, ms: number): Promise<ExtractedStream | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stream = await Promise.race([
        (async () => this.sniffer(embed))(),
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
    const all = precomputed ?? await this.resolveAllStreams(params);
    if (all.length === 0) return null;

    if (params.preferredServerId) {
      const preferred = all.find(s => s.serverId === params.preferredServerId);
      if (preferred) return preferred;
    }

    const titleLower = (params.title || '').toLowerCase();

    // Indian regional language codes or modes
    const hasRegionalLang =
      Boolean(params.language && ['te', 'hi', 'ta', 'ml', 'kn', 'pa', 'bn'].includes(params.language.toLowerCase())) ||
      Boolean(params.languageMode && ['hindi', 'telugu', 'tamil', 'multi'].includes(params.languageMode.toLowerCase()));

    // Non-ASCII characters (Telugu, Hindi, Tamil, Malayalam, Kannada unicode scripts)
    const hasRegionalUnicode = /[\u0C00-\u0C7F\u0900-\u097F\u0B80-\u0BFF\u0D00-\u0D7F\u0C80-\u0CFF]/.test(params.title || '');

    // Regional title keywords & patterns
    const hasRegionalKeywords = /\b(thella|tella|kaagitham|kagitam|kaagidham|bachelor|least|most|pushpa|devara|kalki|salaar|saripodhaa|kanguva|goat|game|boomer|hanuman|tillu|guntur|bramayugam|avesham|lucky|baskhar|amaran|movierulz|telugu|hindi|tamil|malayalam|kannada)\b/i.test(titleLower);

    const isRegional = hasRegionalLang || hasRegionalUnicode || hasRegionalKeywords;

    if (isRegional) {
      // Prioritize regional / multi-embed sources for Indian regional media
      const regionalStream =
        all.find(s => !s.isFallbackEmbed && (s.serverId === 'multiembed' || s.serverId === 'movierulz' || s.serverId === 'insertunit')) ||
        all.find(s => s.serverId === 'multiembed') ||
        all.find(s => s.serverId === 'movierulz') ||
        all.find(s => s.serverId === 'insertunit') ||
        all.find(s => s.serverId === 'autoembed');
      if (regionalStream) return regionalStream;
    }

    // 1. Prefer a direct media stream
    const directStream = all.find(s => !s.isFallbackEmbed);
    if (directStream) return directStream;

    // 2. Fallback embeds: prefer 2Embed/MultiEmbed/AutoEmbed/Movierulz over VidLink/VidSrc
    const cleanEmbed = all.find(s => s.serverId === 'multiembed' || s.serverId === 'autoembed' || s.serverId === 'insertunit' || s.serverId === 'movierulz');
    return cleanEmbed ?? all[0] ?? null;
  }
}

export const extractorRegistry = new ExtractorRegistry();
