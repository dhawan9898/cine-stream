// extractorRegistry.ts - Central registry for stream extractors
import type { StreamExtractor, ExtractedStream } from './types.ts';
import { FastHlsExtractor } from './fastHlsExtractor.ts';
import { VidLinkExtractor } from './vidlinkExtractor.ts';
import { VidSrcExtractor } from './vidsrcExtractor.ts';
import { AutoEmbedExtractor } from './autoembedExtractor.ts';

class ExtractorRegistry {
  private extractors: StreamExtractor[] = [];

  constructor() {
    this.register(new FastHlsExtractor());
    this.register(new VidLinkExtractor());
    this.register(new VidSrcExtractor());
    this.register(new AutoEmbedExtractor());
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
  }): Promise<ExtractedStream | null> {
    // Run extractors in parallel with short timeout, returning the first valid direct stream
    const promises = this.extractors.map(async extractor => {
      try {
        const stream = await Promise.race([
          extractor.extract(params),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 4000))
        ]);
        if (stream && stream.url && !stream.isFallbackEmbed) {
          return stream;
        }
      } catch {
        return null;
      }
      return null;
    });

    const results = await Promise.allSettled(promises);
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value) {
        return res.value;
      }
    }

    // Default fast HLS fallback guarantee
    const fastHls = new FastHlsExtractor();
    return await fastHls.extract(params);
  }
}

export const extractorRegistry = new ExtractorRegistry();
