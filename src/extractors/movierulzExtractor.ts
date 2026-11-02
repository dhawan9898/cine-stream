// movierulzExtractor.ts - Indian regional content extractor (Telugu, Hindi, Tamil, Malayalam, Kannada)
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class MovierulzExtractor extends BaseExtractor {
  id = 'movierulz';
  name = 'Movierulz Regional';
  mainUrl = 'https://5movierulz.site';

  private generateSlugs(title: string): string[] {
    if (!title) return [];
    const clean = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
    const baseSlug = clean.replace(/\s+/g, '-');
    const slugs = [baseSlug];

    if (clean.includes('kagitam') || clean.includes('kaagitham')) {
      slugs.push(baseSlug.replace(/kaagitham|kagitam/g, 'kaagidham'));
      slugs.push(baseSlug.replace(/kaagitham|kagitam/g, 'thella-kaagitham'));
    }
    if (clean.includes('least')) {
      slugs.push(baseSlug.replace(/least/g, 'most'));
    }

    return Array.from(new Set(slugs));
  }

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1, title = '' } = params;
    const cleanTitle = (title || '').trim();

    if (cleanTitle) {
      const slugs = this.generateSlugs(cleanTitle);
      const primaryDomain = 'https://5movierulz.site';

      // Quick candidate check
      const candidate = type === 'tv'
        ? `${primaryDomain}/${slugs[0]}-season-${season}-episode-${episode}/`
        : `${primaryDomain}/${slugs[0]}-movie-watch-online-free.html`;

      try {
        const pageBody = await Promise.race([
          this.httpGet(candidate, { Referer: `${primaryDomain}/` }),
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1800))
        ]);
        const stream = await this.extractFromPageBody(pageBody, candidate);
        if (stream) {
          return { ...stream, serverId: this.id, serverName: this.name };
        }
      } catch {
        // Fast fallback to regional embed stream
      }
    }

    // Regional fallback stream (2embed clean endpoint)
    const fallbackUrl = type === 'tv'
      ? `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${episode}`
      : `https://www.2embed.cc/embed/${id}`;

    return {
      url: fallbackUrl,
      format: 'hls',
      isFallbackEmbed: true,
      serverId: this.id,
      serverName: this.name
    };
  }

  private async extractFromPageBody(body: string, referer: string): Promise<ExtractedStream | null> {
    if (!body) return null;

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

    return await this.resolveFromPage(referer, { referer, maxDepth: 1, maxPages: 2 });
  }
}
