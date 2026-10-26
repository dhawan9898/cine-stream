// extractorRegistry.ts - Central registry for stream extractors
import type { StreamExtractor, ExtractedStream } from './types.ts';
import { VidSrcExtractor } from './vidsrcExtractor.ts';
import { AutoEmbedExtractor } from './autoembedExtractor.ts';

class ExtractorRegistry {
  private extractors = new Map<string, StreamExtractor>();

  constructor() {
    this.register(new VidSrcExtractor());
    this.register(new AutoEmbedExtractor());
  }

  register(extractor: StreamExtractor) {
    this.extractors.set(extractor.id, extractor);
  }

  getExtractor(id: string): StreamExtractor | undefined {
    return this.extractors.get(id);
  }

  async resolveStream(
    serverId: string,
    params: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number }
  ): Promise<ExtractedStream | null> {
    const extractor = this.extractors.get(serverId);
    if (!extractor) return null;

    try {
      return await extractor.extract(params);
    } catch (err) {
      console.warn(`[ExtractorRegistry] Failed to resolve stream for ${serverId}:`, err);
      return null;
    }
  }
}

export const extractorRegistry = new ExtractorRegistry();
