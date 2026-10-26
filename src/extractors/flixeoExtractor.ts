// flixeoExtractor.ts - Title stream extractor for Flixeo (flixeo.tv) provider
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class FlixeoExtractor extends BaseExtractor {
  id = 'flixeo';
  name = 'Flixeo Streaming Server';
  mainUrl = 'https://flixeo.tv';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1 } = params;
    const embedUrl = type === 'tv'
      ? `${this.mainUrl}/tv/${id}/${season}/${episode}`
      : `${this.mainUrl}/movie/${id}`;

    try {
      const extracted = await this.resolveFromPage(embedUrl, { referer: `${this.mainUrl}/` });
      if (extracted) return extracted;
    } catch (err) {
      console.warn(`[${this.id}] Direct stream extraction fallback:`, err);
    }

    return {
      url: embedUrl,
      format: 'hls',
      isFallbackEmbed: true
    };
  }
}
