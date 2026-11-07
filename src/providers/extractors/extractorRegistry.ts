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
const PROVIDER_TIMEOUT_MS = 7000;
const SNIFF_TIMEOUT_MS = 15000;
// After a direct stream arrives, wait this long for a better one then stop.
const EARLY_EXIT_GRACE_MS = 350;
const HEALTH_KEY = 'cinestream_provider_health_v1';
const FAILS_BEFORE_COOLDOWN = 3;
const COOLDOWN_MS = 10 * 60 * 1000;

// Which provider last gave a working stream for a title - tried first next time.
const LAST_GOOD_KEY = 'cinestream_last_good_v1';
const LAST_GOOD_MAX = 300;
const LAST_GOOD_TIMEOUT_MS = 4500;

type Sniffer = (embed: ExtractedStream) => Promise<ExtractedStream | null>;

export class ExtractorRegistry {
  private extractors: StreamExtractor[] = [];
  private sniffer: Sniffer = embed => sniffDirectStream(embed);
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
  }): Promise<ExtractedStream[]> {
    const directOnly = params.directOnly ?? Capacitor.isNativePlatform();
    // Skip providers on cooldown, but never skip everything.
    const healthy = this.extractors.filter(e => !this.isCoolingDown(e.id));
    const active = healthy.length > 0 ? healthy : this.extractors;

    // Shortcut: the provider that worked for this title last time, alone and
    // quickly. Falls through to the full race if it no longer delivers.
    if (!params.fresh && !params.preferredServerId) {
      const goodId = this.lastGood.get(`${params.type}:${params.id}`);
      const good = goodId ? this.extractors.find(e => e.id === goodId && !this.isCoolingDown(e.id)) : undefined;
      if (good) {
        let t: ReturnType<typeof setTimeout> | undefined;
        try {
          const stream = await Promise.race([
            (async () => good.extract(params))(),
            new Promise<null>(r => { t = setTimeout(() => r(null), LAST_GOOD_TIMEOUT_MS); })
          ]);
          if (stream && stream.url && !stream.isFallbackEmbed && !stream.url.startsWith('blob:')) {
            this.recordResult(good.id, true);
            return [{ ...stream, serverId: stream.serverId || good.id, serverName: stream.serverName || good.name }];
          }
        } catch { /* fall through to the full lookup */ } finally {
          if (t) clearTimeout(t);
        }
      }
    }

    const fulfilled: ExtractedStream[] = [];
    const isDirect = (s: ExtractedStream) => !s.isFallbackEmbed;

    // Collect results as they arrive and stop shortly after the first direct
    // stream instead of waiting for the slowest provider.
    await new Promise<void>(resolve => {
      let pending = active.length;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => { if (graceTimer) clearTimeout(graceTimer); resolve(); };
      if (pending === 0) { finish(); return; }

      active.forEach(extractor => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<null>(r => { timer = setTimeout(() => r(null), PROVIDER_TIMEOUT_MS); });
        // extract() may throw synchronously; wrap so one bad provider never breaks the lookup.
        const attempt = (async () => extractor.extract(params))();
        Promise.race([attempt, timeout])
          .catch(() => null)
          .then(stream => {
            if (timer) clearTimeout(timer);
            const ok = Boolean(stream && stream.url && (isDirect(stream) || !directOnly));
            this.recordResult(extractor.id, ok);
            if (stream && stream.url) {
              fulfilled.push({
                ...stream,
                serverId: stream.serverId || extractor.id,
                serverName: stream.serverName || extractor.name
              });
              if (isDirect(stream) && !graceTimer) graceTimer = setTimeout(finish, EARLY_EXIT_GRACE_MS);
            }
          })
          .finally(() => { if (--pending === 0) finish(); });
      });
    });

    // Sort streams: direct non-blob streams first, then other direct streams, then fallback embeds
    const sorted = fulfilled.sort((a, b) => {
      const aDirect = !a.isFallbackEmbed && !a.url.startsWith('blob:') ? 2 : (!a.isFallbackEmbed ? 1 : 0);
      const bDirect = !b.isFallbackEmbed && !b.url.startsWith('blob:') ? 2 : (!b.isFallbackEmbed ? 1 : 0);
      return bDirect - aDirect;
    });

    if (!directOnly) {
      this.rememberGood(params, sorted.find(x => !x.isFallbackEmbed)?.serverId);
      return sorted;
    }

    // Method 2: no provider gave a direct stream from its page/API, so load the
    // embed pages in a hidden WebView and capture the real media request.
    const direct = sorted.filter(s => !s.isFallbackEmbed);
    if (direct.length === 0 && params.allowSniff !== false) {
      const embeds = sorted.filter(s => s.isFallbackEmbed).slice(0, MAX_SNIFF_ATTEMPTS);
      for (const embed of embeds) {
        let sniffed: ExtractedStream | null = null;
        try {
          sniffed = await Promise.race([
            this.sniffer(embed),
            new Promise<null>(r => setTimeout(() => r(null), SNIFF_TIMEOUT_MS))
          ]);
        } catch {
          sniffed = null;
        }
        if (sniffed?.url) {
          direct.push(sniffed);
          break;
        }
      }
    }
    this.rememberGood(params, direct[0]?.serverId);
    return direct;
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
