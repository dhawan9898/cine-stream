// movierulzExtractor.ts - Indian regional content extractor (Hindi, Telugu, Tamil, Malayalam, Kannada, Punjabi, Bengali)
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class MovierulzExtractor extends BaseExtractor {
  id = 'movierulz';
  name = 'Movierulz Regional';
  mainUrl = 'https://www.5movierulz.green';

  private domains = [
    'https://www.5movierulz.green',
    'https://www.5movierulz.recipes',
    'https://www.5movierulz.plumbing',
    'https://www.3movierulz.in'
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
    if (!title || !title.trim()) return null;

    const slug = this.slugify(title);
    const cleanTitle = title.trim();

    for (const domain of this.domains) {
      try {
        // 1. Direct candidate URL check using slug
        const candidateUrl = type === 'tv'
          ? `${domain}/${slug}-season-${season}-episode-${episode}`
          : `${domain}/${slug}`;
        try {
          const pageBody = await this.httpGet(candidateUrl, { Referer: `${domain}/` });
          const stream = await this.extractFromPageBody(pageBody, candidateUrl);
          if (stream) {
            return { ...stream, serverId: this.id, serverName: this.name };
          }
        } catch {
          // Fall through to fast site search
        }

        // 2. Fast site search via WordPress search endpoint (?s=query)
        const searchUrl = `${domain}/?s=${encodeURIComponent(cleanTitle)}`;
        const searchBody = await this.httpGet(searchUrl, { Referer: `${domain}/` });
        const postMatches = [...searchBody.matchAll(/href=["'](https?:\/\/[^"']+\.html)["']/gi)].map(m => m[1]);
        const uniquePosts = Array.from(new Set(postMatches)).slice(0, 3);

        for (const postUrl of uniquePosts) {
          try {
            const postBody = await this.httpGet(postUrl, { Referer: searchUrl });
            const stream = await this.extractFromPageBody(postBody, postUrl);
            if (stream) {
              return { ...stream, serverId: this.id, serverName: this.name };
            }
          } catch {
            // Next post
          }
        }
      } catch {
        // Next domain
      }
    }

    return null;
  }

  private async extractFromPageBody(body: string, referer: string): Promise<ExtractedStream | null> {
    const locationsMatch = body.match(/var\s+(?:locations|players)\s*=\s*\[([\s\S]*?)\];/);
    if (locationsMatch) {
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
    }

    // Fallback page scan if var locations was absent
    return await this.resolveFromPage(referer, { referer, maxDepth: 1, maxPages: 2 });
  }
}
