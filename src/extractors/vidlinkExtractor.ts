// vidlinkExtractor.ts - Direct stream extractor for VidLink PRO
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class VidLinkExtractor extends BaseExtractor {
  id = 'vidlink';
  name = 'VidLink PRO Direct';
  mainUrl = 'https://vidlink.pro';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1 } = params;
    const embedUrl = type === 'tv'
      ? `${this.mainUrl}/tv/${id}/${season}/${episode}?primaryColor=ec1c24&autoplay=true`
      : `${this.mainUrl}/movie/${id}?primaryColor=ec1c24&autoplay=true`;

    try {
      const extracted = await this.resolveFromPage(embedUrl, { referer: `${this.mainUrl}/` });
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
