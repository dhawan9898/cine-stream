// vidsrcExtractor.ts - Stream extractor for VidSrc TO, ME, CC & mirrors
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class VidSrcExtractor extends BaseExtractor {
  id = 'vidsrc';
  name = 'VidSrc Engine';
  mainUrl = 'https://vidsrc.to';

  // Mirrors that still answer (vidsrc.cc / .xyz / .in / .me no longer resolve or only
  // redirect to vidsrc.sh, which vidsrc.to already embeds). Tried together.
  private mirrors = [
    'https://vidsrc.to',
    'https://vidsrc.sh',
    'https://vidsrc.pm'
  ];

  private getEmbedUrl(domain: string, type: 'movie' | 'tv', id: number, season: number, episode: number): string {
    if (domain.includes('vidsrc.sh') || domain.includes('vidsrc.me')) {
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

    // Mirrors are independent: ask them together and take the first direct stream.
    const results = await Promise.all(this.mirrors.map(async domain => {
      try {
        const embedUrl = this.getEmbedUrl(domain, type, id, season, episode);
        return await this.resolveFromPage(embedUrl, { referer: `${domain}/` });
      } catch (err) {
        console.warn(`[${this.id}] Mirror ${domain} direct extraction failed:`, err);
        return null;
      }
    }));
    const extracted = results.find(r => r && r.url);
    if (extracted) {
      return { ...extracted, serverId: this.id, serverName: this.name };
    }

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
