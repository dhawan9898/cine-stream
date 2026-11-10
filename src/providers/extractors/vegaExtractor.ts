// vegaExtractor.ts - Zenda-Cross / Vega-App Stream Provider
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class VegaExtractor extends BaseExtractor {
  id = 'vega';
  name = 'Vega Engine';
  mainUrl = 'https://vidsrc.to';

  private mirrors = [
    'https://vidsrc.to',
    'https://vidsrc.pm',
    'https://vidsrc.sh'
  ];

  private defaultMirrors = [...this.mirrors];
  private defaultMainUrl = this.mainUrl;

  /** vidsrc.to's embed page: sniffed at once, in parallel with the static attempt on the mirrors. */
  embedUrl(params: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number }): string {
    const { id, type, season = 1, episode = 1 } = params;
    return `${this.mainUrl}${type === 'tv' ? `/embed/tv/${id}/${season}/${episode}` : `/embed/movie/${id}`}`;
  }

  applyConfig(override: { mainUrl?: string; mirrors?: string[] }): void {
    this.mainUrl = override.mainUrl ?? this.defaultMainUrl;
    this.mirrors = override.mirrors && override.mirrors.length ? [...override.mirrors] : [...this.defaultMirrors];
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

    const embedPath = type === 'tv'
      ? `/embed/tv/${id}/${season}/${episode}`
      : `/embed/movie/${id}`;

    // Query mirrors in parallel for sub-second response
    const attempts = this.mirrors.map(async domain => {
      const targetUrl = `${domain}${embedPath}`;
      try {
        const extracted = await this.resolveFromPage(targetUrl, {
          referer: `${domain}/`,
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
        // continue to next mirror
      }
      return null;
    });

    // First mirror that yields a direct stream wins; slower mirrors are not waited for.
    const direct = await new Promise<ExtractedStream | null>(resolve => {
      let left = attempts.length;
      attempts.forEach(a => a.then(r => {
        if (r && r.url) resolve(r);
        else if (--left === 0) resolve(null);
      }, () => { if (--left === 0) resolve(null); }));
    });
    if (direct) return direct;

    // High reliability fallback embed URL
    const primaryEmbedUrl = `${this.mainUrl}${embedPath}`;
    return {
      url: primaryEmbedUrl,
      format: 'hls',
      isFallbackEmbed: true,
      serverId: this.id,
      serverName: this.name
    };
  }
}
