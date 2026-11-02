// embedSuExtractor.ts - Title stream extractor for Embed.su provider
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class EmbedSuExtractor extends BaseExtractor {
  id = 'embedsu';
  name = 'Embed.su Streaming';
  mainUrl = 'https://embed.su';

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
