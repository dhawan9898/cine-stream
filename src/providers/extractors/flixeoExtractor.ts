// flixeoExtractor.ts - Title stream extractor for Flixeo (flixeo.tv) provider
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class FlixeoExtractor extends BaseExtractor {
  id = 'flixeo';
  name = 'Flixeo Server';
  mainUrl = 'https://flixeo.tv';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    signal?: AbortSignal;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1, signal } = params;
    if (signal?.aborted) return null;

    const embedUrl = type === 'tv'
      ? `${this.mainUrl}/tv/${id}/${season}/${episode}`
      : `${this.mainUrl}/movie/${id}`;

    try {
      const extracted = await this.resolveFromPage(embedUrl, {
        referer: `${this.mainUrl}/`,
        maxDepth: 1,
        maxPages: 2,
        signal,
        timeoutMs: 2500
      });
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
