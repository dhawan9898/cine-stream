// cinehypeExtractor.ts - Native CineHype Stream Extractor
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class CineHypeExtractor extends BaseExtractor {
  id = 'cinehype';
  name = 'CineHype Server';
  mainUrl = 'https://vidfast.vc';

  /** The player page, sniffed at once in parallel with the static attempt. */
  embedUrl(params: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number }): string {
    const { id, type, season = 1, episode = 1 } = params;
    return type === 'tv'
      ? `${this.mainUrl}/tv/${id}/${season}/${episode}?autoPlay=true&theme=ec1c24&nextButton=true`
      : `${this.mainUrl}/movie/${id}?autoPlay=true&theme=ec1c24`;
  }

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    signal?: AbortSignal;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1, signal } = params;
    if (signal?.aborted) return null;

    const primaryUrl = type === 'tv'
      ? `${this.mainUrl}/tv/${id}/${season}/${episode}?autoPlay=true&theme=ec1c24&nextButton=true`
      : `${this.mainUrl}/movie/${id}?autoPlay=true&theme=ec1c24`;

    try {
      const extracted = await this.resolveFromPage(primaryUrl, {
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
    } catch {
      // fallback to embed
    }

    return {
      url: primaryUrl,
      format: 'hls',
      isFallbackEmbed: true,
      serverId: this.id,
      serverName: this.name
    };
  }
}
