// riveExtractor.ts - Title stream extractor for Rive Stream provider
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class RiveExtractor extends BaseExtractor {
  id = 'rive';
  name = 'Rive Stream';
  mainUrl = 'https://rive.ws';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1 } = params;
    const embedUrl = type === 'tv'
      ? `${this.mainUrl}/embed?type=tv&id=${id}&season=${season}&episode=${episode}`
      : `${this.mainUrl}/embed?type=movie&id=${id}`;

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
