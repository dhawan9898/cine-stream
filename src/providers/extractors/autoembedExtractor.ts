// autoembedExtractor.ts - Stream extractor for AutoEmbed CDN sources
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class AutoEmbedExtractor extends BaseExtractor {
  id = 'autoembed';
  name = 'AutoEmbed CDN';
  // autoembed.co now redirects to autoembed.me. Use the final host: the sniffer's
  // web view treats a main-frame redirect as an ad hijack, so a redirecting URL never loaded.
  mainUrl = 'https://autoembed.me';


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

    // (The old player.autoembed.cc mirror no longer resolves, so there is only one page to try.)
    for (const targetUrl of [embedUrl]) {
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
        console.warn(`[${this.id}] Direct extraction fallback to embed:`, err);
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
