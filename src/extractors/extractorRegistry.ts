// extractorRegistry.ts - Central registry for real title-specific stream extractors
import type { StreamExtractor, ExtractedStream } from './types.ts';
import { FlixeoExtractor } from './flixeoExtractor.ts';
import { MovierulzExtractor } from './movierulzExtractor.ts';
import { VidLinkExtractor } from './vidlinkExtractor.ts';
import { VidSrcExtractor } from './vidsrcExtractor.ts';
import { AutoEmbedExtractor } from './autoembedExtractor.ts';
import { MultiEmbedExtractor } from './multiembedExtractor.ts';
import { EmbedSuExtractor } from './embedSuExtractor.ts';
import { SmashyExtractor } from './smashyExtractor.ts';
import { RiveExtractor } from './riveExtractor.ts';
import { InsertUnitExtractor } from './insertunitExtractor.ts';
import { TelegramExtractor } from './telegramExtractor.ts';

class ExtractorRegistry {
  private extractors: StreamExtractor[] = [];

  constructor() {
    // Primary streaming sources
    this.register(new VidLinkExtractor());
    this.register(new VidSrcExtractor());
    this.register(new FlixeoExtractor());
    this.register(new RiveExtractor());
    this.register(new AutoEmbedExtractor());
    this.register(new EmbedSuExtractor());
    this.register(new MovierulzExtractor());
    this.register(new MultiEmbedExtractor());
    this.register(new InsertUnitExtractor());
    this.register(new SmashyExtractor());
    // Secondary / private channel source
    this.register(new TelegramExtractor());
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
  }): Promise<ExtractedStream[]> {
    const timeoutMs = 7000;
    const promises = this.extractors.map(async (extractor): Promise<ExtractedStream | null> => {
      try {
        const stream = await Promise.race([
          extractor.extract(params),
          new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs))
        ]);
        if (stream && stream.url) {
          return {
            ...stream,
            serverId: stream.serverId || extractor.id,
            serverName: stream.serverName || extractor.name
          };
        }
      } catch {
        return null;
      }
      return null;
    });

    const results = await Promise.allSettled(promises);
    const fulfilled: ExtractedStream[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.url) {
        fulfilled.push(r.value);
      }
    }

    // Sort streams: direct non-blob streams first, then other direct streams, then fallback embeds
    return fulfilled.sort((a, b) => {
      const aDirect = !a.isFallbackEmbed && !a.url.startsWith('blob:') ? 2 : (!a.isFallbackEmbed ? 1 : 0);
      const bDirect = !b.isFallbackEmbed && !b.url.startsWith('blob:') ? 2 : (!b.isFallbackEmbed ? 1 : 0);
      return bDirect - aDirect;
    });
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
  }): Promise<ExtractedStream | null> {
    const all = await this.resolveAllStreams(params);
    if (all.length === 0) return null;

    if (params.preferredServerId) {
      const preferred = all.find(s => s.serverId === params.preferredServerId);
      if (preferred) return preferred;
    }

    const isRegional =
      (params.language && ['te', 'hi', 'ta', 'ml', 'kn', 'pa', 'bn'].includes(params.language.toLowerCase())) ||
      (params.languageMode && ['hindi', 'telugu', 'tamil'].includes(params.languageMode.toLowerCase()));

    if (isRegional) {
      // Prioritize regional sources (movierulz, multiembed, insertunit) for Indian regional media
      const regionalStream =
        all.find(s => !s.isFallbackEmbed && (s.serverId === 'movierulz' || s.serverId === 'multiembed' || s.serverId === 'insertunit'));
      // Note: movierulz/multiembed fallback embeds are 2embed web pages that sit behind a
      // Cloudflare "verify you are human" challenge, so never select them as the best stream.
      if (regionalStream) return regionalStream;
    }

    // 1. Prefer direct media stream (non-fallback, non-blob)
    const primaryDirectStream = all.find(s => !s.isFallbackEmbed && !s.url.startsWith('blob:'));
    if (primaryDirectStream) return primaryDirectStream;

    // 2. Secondary direct stream (e.g. verified Telegram file)
    const secondaryDirectStream = all.find(s => !s.isFallbackEmbed);
    if (secondaryDirectStream) return secondaryDirectStream;

    // 3. First fallback embed, avoiding Cloudflare-protected 2embed pages when possible
    return all.find(s => s.serverId !== 'movierulz' && s.serverId !== 'multiembed') ?? all[0] ?? null;
  }
}

export const extractorRegistry = new ExtractorRegistry();
