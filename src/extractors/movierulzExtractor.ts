// movierulzExtractor.ts - Indian regional content extractor (Hindi, Telugu, Tamil, Malayalam, Kannada, Punjabi, Bengali)
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class MovierulzExtractor extends BaseExtractor {
  id = 'movierulz';
  name = 'Movierulz Indian Regional Engine';
  mainUrl = 'https://www.5movierulz.green';

  private domains = [
    'https://www.5movierulz.green',
    'https://www.5movierulz.recipes',
    'https://www.5movierulz.plumbing',
    'https://www.3movierulz.in'
  ];

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null> {
    // Search Movierulz for regional title matching
    for (const domain of this.domains) {
      try {
        const searchUrl = `${domain}/?s=${params.id}`;
        const searchBody = await this.httpGet(searchUrl, { Referer: `${domain}/` });

        // Find movie Watch Online links
        const matches = [...searchBody.matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+\.html)["']/gi)].map(m => m[1]);
        if (matches.length === 0) continue;

        const moviePageUrl = matches[0];
        const movieBody = await this.httpGet(moviePageUrl, { Referer: searchUrl });

        // Extract locations / players iframe URLs
        const locationsMatch = movieBody.match(/var\s+(?:locations|players)\s*=\s*\[([\s\S]*?)\];/);
        if (!locationsMatch) continue;

        const rawUrls = [...locationsMatch[1].matchAll(/["']([^"']+)["']/g)].map(m => m[1].replace(/\\\//g, '/'));
        for (const rawUrl of rawUrls) {
          if (rawUrl.includes('m3u8') || rawUrl.includes('.mp4')) {
            return {
              url: rawUrl,
              format: 'hls',
              quality: '1080p',
              headers: { Referer: moviePageUrl, 'User-Agent': this.defaultUserAgent }
            };
          }

          // Extract direct source from vcdnlare / player iframe
          const iframeStream = await this.resolveFromPage(rawUrl, { referer: moviePageUrl });
          if (iframeStream && iframeStream.url) {
            return iframeStream;
          }
        }
      } catch {
        // Continue silently to next domain
      }
    }

    return null;
  }
}
