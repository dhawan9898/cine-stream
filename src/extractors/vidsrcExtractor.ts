// vidsrcExtractor.ts - Stream extractor for VidSrc TO & VidSrc ME mirrors
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class VidSrcExtractor extends BaseExtractor {
  id = 'vidsrc';
  name = 'VidSrc TO';
  mainUrl = 'https://vidsrc.to';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1 } = params;
    const embedUrl = type === 'tv'
      ? `${this.mainUrl}/embed/tv/${id}/${season}/${episode}`
      : `${this.mainUrl}/embed/movie/${id}`;

    try {
      const extracted = await this.resolveFromPage(embedUrl, { referer: 'https://vidsrc.to/' });
      if (extracted) return extracted;
    } catch (err) {
      console.warn(`[${this.id}] Direct extraction fallback to embed:`, err);
    }

    return {
      url: embedUrl,
      format: 'hls',
      isFallbackEmbed: true
    };
  }
}
