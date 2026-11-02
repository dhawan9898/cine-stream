// insertunitExtractor.ts - Title stream extractor for InsertUnit provider
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class InsertUnitExtractor extends BaseExtractor {
  id = 'insertunit';
  name = 'InsertUnit Engine';
  mainUrl = 'https://api.insertunit.com';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1 } = params;
    const embedUrl = type === 'tv'
      ? `${this.mainUrl}/embed/tmdb/${id}?season=${season}&episode=${episode}`
      : `${this.mainUrl}/embed/tmdb/${id}`;

    try {
      const extracted = await this.resolveFromPage(embedUrl, { referer: `${this.mainUrl}/` });
      if (extracted && extracted.url) {
        return {
          ...extracted,
          serverId: this.id,
          serverName: this.name
        };
      }
    } catch (err) {
      console.warn(`[${this.id}] Direct stream extraction fallback:`, err);
    }

    return {
      url: embedUrl,
      format: 'hls',
      isFallbackEmbed: true,
      serverId: this.id,
      serverName: this.name
    };
  }
}
