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

  private categories = [
    '/category/telugu-featured/',
    '/category/tv-series/',
    '/category/hindi-featured/',
    '/category/tamil-featured/',
    '/category/malayalam-featured/',
    '/'
  ];

  private slugify(title: string): string {
    return (title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
  }

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
  }): Promise<ExtractedStream | null> {
    const { type, season = 1, episode = 1, title = '' } = params;
    const slug = this.slugify(title);
    const keywords = (title || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);

    for (const domain of this.domains) {
      try {
        // 1. Try direct candidate URLs
        const candidates: string[] = [];
        if (slug) {
          if (type === 'tv') {
            candidates.push(`${domain}/${slug}-season-${season}-episode-${episode}`);
            candidates.push(`${domain}/${slug}-season-${season}`);
            candidates.push(`${domain}/${slug}`);
          } else {
            candidates.push(`${domain}/${slug}`);
          }
        }

        for (const candidate of candidates) {
          try {
            const pageBody = await this.httpGet(candidate, { Referer: `${domain}/` });
            const stream = await this.extractFromPageBody(pageBody, candidate);
            if (stream) return stream;
          } catch {
            // Continue
          }
        }

        // 2. Scan category feeds for title keywords
        for (const catPath of this.categories) {
          try {
            const catUrl = `${domain}${catPath}`;
            const catBody = await this.httpGet(catUrl, { Referer: `${domain}/` });
            const postMatches = [...catBody.matchAll(/href=["'](https?:\/\/[^"']+\d+\.html)["']/gi)].map(m => m[1]);

            for (const postUrl of postMatches) {
              const lowerUrl = postUrl.toLowerCase();
              const matchedCount = keywords.filter(k => lowerUrl.includes(k)).length;
              if (keywords.length === 0 || matchedCount >= 1) {
                const postBody = await this.httpGet(postUrl, { Referer: catUrl });
                const stream = await this.extractFromPageBody(postBody, postUrl);
                if (stream) return stream;
              }
            }
          } catch {
            // Continue to next category
          }
        }
      } catch {
        // Continue silently to next domain
      }
    }

    return null;
  }

  private async extractFromPageBody(body: string, referer: string): Promise<ExtractedStream | null> {
    const locationsMatch = body.match(/var\s+(?:locations|players)\s*=\s*\[([\s\S]*?)\];/);
    if (!locationsMatch) return null;

    const rawUrls = [...locationsMatch[1].matchAll(/["']([^"']+)["']/g)].map(m => m[1].replace(/\\\//g, '/'));
    for (const rawUrl of rawUrls) {
      if (rawUrl.includes('m3u8') || rawUrl.includes('.mp4')) {
        return {
          url: rawUrl,
          format: 'hls',
          quality: '1080p',
          headers: { Referer: referer, 'User-Agent': this.defaultUserAgent }
        };
      }

      const iframeStream = await this.resolveFromPage(rawUrl, { referer });
      if (iframeStream && iframeStream.url) {
        return iframeStream;
      }
    }

    return null;
  }
}
