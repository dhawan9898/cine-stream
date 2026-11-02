// multiembedExtractor.ts - Direct stream extractor for MultiEmbed / 2Embed
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class MultiEmbedExtractor extends BaseExtractor {
  id = 'multiembed';
  name = 'MultiEmbed Server';
  mainUrl = 'https://www.2embed.cc';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1 } = params;
    const targetUrl = type === 'tv'
      ? `${this.mainUrl}/embedtv/${id}&s=${season}&e=${episode}`
      : `${this.mainUrl}/embed/${id}`;

    try {
      const extracted = await this.resolveFromPage(targetUrl, { referer: `${this.mainUrl}/` });
      if (extracted && extracted.url) {
        return {
          ...extracted,
          serverId: this.id,
          serverName: this.name
        };
      }
    } catch (err) {
      console.warn(`[${this.id}] MultiEmbed extraction failed for TMDB ${id}:`, err);
    }

    // No fallback embed: the 2embed page sits behind a Cloudflare human-verification
    // challenge and can never play inside the native player.
    return null;
  }
}
