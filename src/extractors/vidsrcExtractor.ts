// vidsrcExtractor.ts - Stream extractor for VidSrc TO & VidSrc ME mirrors
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class VidSrcExtractor extends BaseExtractor {
  id = 'vidsrc';
  name = 'VidSrc TO';
  mainUrl = 'https://vidsrc.to';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1 } = params;
    const embedUrl = type === 'tv'
      ? `${this.mainUrl}/embed/tv/${id}/${season}/${episode}`
      : `${this.mainUrl}/embed/movie/${id}`;

    try {
      const html = await this.httpGet(embedUrl, {
        Referer: 'https://vidsrc.to/',
        Origin: 'https://vidsrc.to'
      });

      // Look for embedded direct m3u8 or source endpoint references in page
      const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
      if (m3u8Match) {
        return {
          url: m3u8Match[0],
          format: 'hls',
          headers: {
            Referer: 'https://vidsrc.to/',
            Origin: 'https://vidsrc.to',
            'User-Agent': this.defaultUserAgent
          }
        };
      }
    } catch (err) {
      console.warn(`[${this.id}] Native extraction failed, returning fallback embed URL:`, err);
    }

    // Return structured embed fallback if raw stream parsing falls back
    return {
      url: embedUrl,
      format: 'hls',
      isFallbackEmbed: true
    };
  }
}
