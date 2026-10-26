// multiembedExtractor.ts - Direct stream extractor for MultiEmbed / 2Embed
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class MultiEmbedExtractor extends BaseExtractor {
  id = 'multiembed';
  name = 'MultiEmbed Stream Engine';
  mainUrl = 'https://multiembed.mov';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1 } = params;
    const targetUrl = type === 'tv'
      ? `${this.mainUrl}/directstream.php?video_id=${id}&tmdb=1&s=${season}&e=${episode}`
      : `${this.mainUrl}/directstream.php?video_id=${id}&tmdb=1`;

    try {
      const extracted = await this.resolveFromPage(targetUrl, { referer: `${this.mainUrl}/` });
      if (extracted) return extracted;
    } catch (err) {
      console.warn(`[${this.id}] MultiEmbed extraction failed for TMDB ${id}:`, err);
    }

    return null;
  }
}
