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
import { TelegramExtractor } from './telegramExtractor.ts';

class ExtractorRegistry {
  private extractors: StreamExtractor[] = [];

  constructor() {
    // Primary streaming sources
    this.register(new FlixeoExtractor());
    this.register(new MovierulzExtractor());
    this.register(new VidLinkExtractor());
    this.register(new VidSrcExtractor());
    this.register(new AutoEmbedExtractor());
    this.register(new MultiEmbedExtractor());
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

  async resolveBestStream(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
  }): Promise<ExtractedStream | null> {
    // Run extractors concurrently with a 4.5s timeout per extractor
    const promises = this.extractors.map(async extractor => {
      try {
        const stream = await Promise.race([
          extractor.extract(params),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 4500))
        ]);
        if (stream && stream.url) {
          return stream;
        }
      } catch {
        return null;
      }
      return null;
    });

    const results = await Promise.allSettled(promises);
    const fulfilled = results
      .filter((r): r is PromiseFulfilledResult<ExtractedStream | null> => r.status === 'fulfilled' && Boolean(r.value && r.value.url))
      .map(r => r.value!);

    // 1. Prefer direct media streams from primary sources (where isFallbackEmbed is not true and not blob)
    const primaryDirectStream = fulfilled.find(s => s && !s.isFallbackEmbed && !s.url.startsWith('blob:'));
    if (primaryDirectStream) {
      return primaryDirectStream;
    }

    // 2. Secondary direct stream (e.g. verified Telegram media file)
    const secondaryDirectStream = fulfilled.find(s => s && !s.isFallbackEmbed);
    if (secondaryDirectStream) {
      return secondaryDirectStream;
    }

    // 3. Otherwise return first valid title stream (embed fallback)
    return fulfilled[0] ?? null;
  }
}

export const extractorRegistry = new ExtractorRegistry();
