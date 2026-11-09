// extractorRegistry.ts - Central registry for real title-specific stream extractors
import type { StreamExtractor, ExtractedStream } from './types.ts';
import { sniffDirectStream } from '../webSniffer.ts';
import { ProviderHealth, LastGoodStore } from 'streamkit/providers/health.ts';
import { VegaExtractor } from './vegaExtractor.ts';
import { FlixeoExtractor } from './flixeoExtractor.ts';
import { CineHypeExtractor } from './cinehypeExtractor.ts';
import { MovierulzExtractor } from './movierulzExtractor.ts';

const MAX_SNIFF_ATTEMPTS = 4;
const SNIFF_CONCURRENCY = 2;
const PROVIDER_TIMEOUT_MS = 3500;
const SNIFF_TIMEOUT_MS = 8000;
const RESOLVE_DEADLINE_MS = 15000;
const EARLY_EXIT_GRACE_MS = 250;
const HEALTH_KEY = 'cinestream_provider_health_v1';
const FAILS_BEFORE_COOLDOWN = 3;
const COOLDOWN_MS = 10 * 60 * 1000;

const LAST_GOOD_KEY = 'cinestream_last_good_v1';
const LAST_GOOD_MAX = 300;
const LAST_GOOD_TIMEOUT_MS = 2500;
const LAST_GOOD_SNIFF_TIMEOUT_MS = 6000;

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

  setSniffer(fn: Sniffer) {
    this.sniffer = fn;
  }

  constructor(withDefaults = true) {
    if (!withDefaults) return;
    this.register(new MovierulzExtractor());
    this.register(new FlixeoExtractor());
    this.register(new VegaExtractor());
    this.register(new CineHypeExtractor());
  }

  register(extractor: StreamExtractor) {
    this.extractors.push(extractor);
  }

  getAllExtractors(): StreamExtractor[] {
    return [...this.extractors];
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
      const preferred = this.extractors.find(e => e.id === preferredServerId);
      const rest = this.extractors.filter(e => e.id !== preferredServerId);
      return preferred ? [preferred, ...rest] : this.extractors;
    }
    const primaryId = isRegional
      ? 'movierulz'
      : (type === 'movie' ? 'vega' : 'flixeo');
    const primary = this.extractors.find(e => e.id === primaryId);
    const rest = this.extractors.filter(e => e.id !== primaryId);
    return primary ? [primary, ...rest] : this.extractors;
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
  }): Promise<ExtractedStream[]> {
    // Embed/iframe pages are never returned: only direct streams (or sniffed ones) can be played.
    const directOnly = true;
    const canSniff = directOnly && params.allowSniff !== false;
    const isRegional = this.isRegionalTitle(params.title, params.language);
    const ordered = this.getOrderedExtractors(params.type, params.preferredServerId, isRegional);
    const excluded = new Set(params.exclude ?? []);
    const notExcluded = ordered.filter(e => !excluded.has(e.id));
    const usable = notExcluded.length > 0 ? notExcluded : ordered;
    const healthy = usable.filter(e => !this.isCoolingDown(e.id));
    const active = healthy.length > 0 ? healthy : usable;
    const goodId = this.lastGood.get(`${params.type}:${params.id}`);

    // Shortcut: provider that worked for this title last time (directOnly native playback)
    if (!params.fresh && !params.preferredServerId && directOnly) {
      const good = goodId ? active.find(e => e.id === goodId) : undefined;
      if (good) {
        const viaGood = await this.tryProvider(good, params, canSniff, directOnly);
        if (viaGood) {
          this.rememberGood(params, good.id);
          return [viaGood];
        }
      }
    }

    const race = active.filter(e => !(e.id === goodId && !params.fresh && !params.preferredServerId && directOnly));
    const raceList = race.length > 0 ? race : active;

    return new Promise<ExtractedStream[]>(resolve => {
      const found: ExtractedStream[] = [];
      const queue: ExtractedStream[] = [];
      const queuedUrls = new Set<string>();
      let pendingExtract = raceList.length;
      let sniffRunning = 0;
      let sniffStarted = 0;
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
          const embed = queue.shift()!;
          sniffRunning++;
          sniffStarted++;
          this.sniffWithTimeout(embed, SNIFF_TIMEOUT_MS).then(stream => {
            sniffRunning--;
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
        if (embed.serverId && embed.serverId === goodId) queue.unshift(embed);
        else queue.push(embed);
      };

      deadline = setTimeout(finish, RESOLVE_DEADLINE_MS);
      if (raceList.length === 0) { finish(); return; }

      // Concurrent parallel execution across extractors
      raceList.forEach(extractor => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<null>(r => { timer = setTimeout(() => r(null), PROVIDER_TIMEOUT_MS); });

        const attempt = (async () => extractor.extract({ ...params, signal: abortController.signal }))();
        Promise.race([attempt, timeout])
          .catch(() => null)
          .then(stream => {
            if (timer) clearTimeout(timer);
            if (done) return;

            // Stream health check: verify valid URL and stream presence
            if (stream && stream.url && stream.url.trim().length > 0) {
              const tagged = {
                ...stream,
                serverId: stream.serverId || extractor.id,
                serverName: stream.serverName || extractor.name
              };
              if (!tagged.isFallbackEmbed) {
                this.recordResult(extractor.id, true);
                found.push(tagged);
                finishSoon();
              } else if (canSniff) {
                enqueue(tagged);
              } else {
                // An embed page cannot be played and cannot be sniffed here: a failure for this lookup.
                this.recordResult(extractor.id, false);
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
      if (!canSniff) { this.recordResult(extractor.id, false); return null; }
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
