// vidsrcExtractor.ts - Stream extractor for VidSrc TO, ME, CC & mirrors
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class VidSrcExtractor extends BaseExtractor {
  id = 'vidsrc';
  name = 'VidSrc Engine';
  mainUrl = 'https://vidsrc.to';

  private mirrors = [
    'https://vidsrc.to',
    'https://vidsrc.me',
    'https://vidsrc.cc',
    'https://vidsrc.xyz',
    'https://vidsrc.in',
    'https://vidsrc.pm'
  ];

  private getEmbedUrl(domain: string, type: 'movie' | 'tv', id: number, season: number, episode: number): string {
    if (domain.includes('vidsrc.me') || domain.includes('vidsrc.xyz')) {
      return type === 'tv'
        ? `${domain}/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`
        : `${domain}/embed/movie?tmdb=${id}`;
    }
    return type === 'tv'
      ? `${domain}/embed/tv/${id}/${season}/${episode}`
      : `${domain}/embed/movie/${id}`;
  }

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1 } = params;

    for (const domain of this.mirrors) {
      const embedUrl = this.getEmbedUrl(domain, type, id, season, episode);
      try {
        const extracted = await this.resolveFromPage(embedUrl, { referer: `${domain}/` });
        if (extracted && extracted.url) {
          return {
            ...extracted,
            serverId: this.id,
            serverName: this.name
          };
        }
      } catch (err) {
        console.warn(`[${this.id}] Mirror ${domain} direct extraction failed:`, err);
      }
    }

    // Default primary fallback embed
    const primaryEmbedUrl = this.getEmbedUrl(this.mainUrl, type, id, season, episode);
    return {
      url: primaryEmbedUrl,
      format: 'hls',
      isFallbackEmbed: true,
      serverId: this.id,
      serverName: this.name
    };
  }
}
