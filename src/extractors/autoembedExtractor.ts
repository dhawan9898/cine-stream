// autoembedExtractor.ts - Stream extractor for AutoEmbed CDN sources
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class AutoEmbedExtractor extends BaseExtractor {
  id = 'autoembed';
  name = 'AutoEmbed CDN';
  mainUrl = 'https://autoembed.co';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1 } = params;
    const embedUrl = type === 'tv'
      ? `${this.mainUrl}/tv/tmdb/${id}-${season}-${episode}`
      : `${this.mainUrl}/movie/tmdb/${id}`;

    try {
      return await this.resolveFromPage(embedUrl, { referer: 'https://autoembed.co/' });
    } catch (err) {
      console.warn(`[${this.id}] Direct extraction failed:`, err);
      return null;
    }
  }
}
