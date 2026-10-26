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
    const apiUrl = type === 'tv'
      ? `${this.mainUrl}/api/b/tv/${id}/${season}/${episode}`
      : `${this.mainUrl}/api/b/movie/${id}`;

    try {
      const responseText = await this.httpGet(apiUrl, {
        Referer: `${this.mainUrl}/`,
        Origin: this.mainUrl
      });

      const extracted = await this.resolveFromPage(apiUrl, { referer: `${this.mainUrl}/` });
      if (extracted) return extracted;
    } catch (err) {
      console.warn(`[${this.id}] Direct extraction failed:`, err);
    }

    return null;
  }
}
