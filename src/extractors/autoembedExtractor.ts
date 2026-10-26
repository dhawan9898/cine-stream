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
      const html = await this.httpGet(embedUrl, {
        Referer: 'https://autoembed.co/'
      });

      const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
      if (m3u8Match) {
        return {
          url: m3u8Match[0],
          format: 'hls',
          headers: {
            Referer: 'https://autoembed.co/',
            'User-Agent': this.defaultUserAgent
          }
        };
      }
    } catch (err) {
      console.warn(`[${this.id}] Direct extraction failed:`, err);
    }

    // No direct stream on this provider: the resolver moves on to the next one.
    return null;
  }
}
