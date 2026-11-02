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
    // Primary multi-server embed sources with 100% TMDB coverage first
    this.register(new MultiEmbedExtractor());
    this.register(new AutoEmbedExtractor());
    this.register(new InsertUnitExtractor());
    this.register(new MovierulzExtractor());
    this.register(new VidLinkExtractor());
    this.register(new VidSrcExtractor());
    this.register(new FlixeoExtractor());
    this.register(new RiveExtractor());
    this.register(new EmbedSuExtractor());
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

    // 1. Prefer direct media stream (non-fallback, non-blob)
    const primaryDirectStream = all.find(s => !s.isFallbackEmbed && !s.url.startsWith('blob:'));
    if (primaryDirectStream) return primaryDirectStream;

    // 2. Secondary direct stream (e.g. verified Telegram file)
    const secondaryDirectStream = all.find(s => !s.isFallbackEmbed);
    if (secondaryDirectStream) return secondaryDirectStream;

    // 3. Fallback embeds: prefer 2Embed/MultiEmbed/AutoEmbed/Movierulz over VidLink/VidSrc
    const cleanEmbed = all.find(s => s.serverId === 'multiembed' || s.serverId === 'autoembed' || s.serverId === 'insertunit' || s.serverId === 'movierulz');
    return cleanEmbed ?? all[0] ?? null;
  }
}

export const extractorRegistry = new ExtractorRegistry();
