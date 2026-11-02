// smashyExtractor.ts - Title stream extractor for SmashyStream provider
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class SmashyExtractor extends BaseExtractor {
  id = 'smashy';
  name = 'SmashyStream Engine';
  mainUrl = 'https://player.smashy.stream';

  private mirrorUrl = 'https://embed.smashystream.com';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1 } = params;
    const embedUrl = type === 'tv'
      ? `${this.mainUrl}/tv/${id}?s=${season}&e=${episode}`
      : `${this.mainUrl}/movie/${id}`;

    const mirrorEmbedUrl = type === 'tv'
      ? `${this.mirrorUrl}/playere.php?tmdb=${id}&season=${season}&episode=${episode}`
      : `${this.mirrorUrl}/playere.php?tmdb=${id}`;

    for (const targetUrl of [embedUrl, mirrorEmbedUrl]) {
      try {
        const extracted = await this.resolveFromPage(targetUrl, { referer: `${new URL(targetUrl).origin}/` });
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
