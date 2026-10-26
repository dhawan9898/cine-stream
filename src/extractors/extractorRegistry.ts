// extractorRegistry.ts - Central registry for real title-specific stream extractors
import type { StreamExtractor, ExtractedStream } from './types.ts';
import { VidLinkExtractor } from './vidlinkExtractor.ts';
import { VidSrcExtractor } from './vidsrcExtractor.ts';
import { AutoEmbedExtractor } from './autoembedExtractor.ts';
import { MultiEmbedExtractor } from './multiembedExtractor.ts';

class ExtractorRegistry {
  private extractors: StreamExtractor[] = [];

  constructor() {
    this.register(new VidLinkExtractor());
    this.register(new VidSrcExtractor());
    this.register(new AutoEmbedExtractor());
    this.register(new MultiEmbedExtractor());
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
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value) {
        return res.value;
      }
    }

    return null;
  }
}

export const extractorRegistry = new ExtractorRegistry();
