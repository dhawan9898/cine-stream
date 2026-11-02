// vidlinkExtractor.ts - Direct stream extractor for VidLink PRO
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class VidLinkExtractor extends BaseExtractor {
  id = 'vidlink';
  name = 'VidLink PRO';
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

    // Method 1: VidLink's JSON endpoint (the original direct-stream method).
    const apiUrl = type === 'tv'
      ? `${this.mainUrl}/api/b/tv/${id}/${season}/${episode}`
      : `${this.mainUrl}/api/b/movie/${id}`;
    try {
      const extracted = await this.resolveFromPage(apiUrl, { referer: `${this.mainUrl}/`, maxDepth: 0, maxPages: 1 });
      if (extracted?.url) {
        return { ...extracted, serverId: this.id, serverName: this.name };
      }
    } catch (err) {
      console.warn(`[${this.id}] API extraction failed, trying embed page:`, err);
    }

    // Method 2: scan the embed page; the registry's web-view sniffer handles the rest.
    try {
      const extracted = await this.resolveFromPage(embedUrl, { referer: `${this.mainUrl}/` });
      if (extracted) {
        return {
          ...extracted,
          serverId: this.id,
          serverName: this.name
        };
      }
    } catch (err) {
      console.warn(`[${this.id}] Direct extraction fallback to embed:`, err);
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
