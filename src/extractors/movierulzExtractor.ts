// movierulzExtractor.ts - Indian regional content extractor (Telugu, Hindi, Tamil, Malayalam, Kannada, Multi-Audio)
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class MovierulzExtractor extends BaseExtractor {
  id = 'movierulz';
  name = 'Movierulz Regional';
  mainUrl = 'https://5movierulz.site';

  private generateSlugs(title: string, languageMode?: string): string[] {
    if (!title) return [];
    const clean = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
    const baseSlug = clean.replace(/\s+/g, '-');
    const slugs: string[] = [];

    // 1. Multi-audio & Multi-language priority slugs
    if (languageMode === 'multi' || !languageMode || languageMode === 'sub' || languageMode === 'dub') {
      slugs.push(`${baseSlug}-multi-audio`);
      slugs.push(`${baseSlug}-dual-audio`);
    }

    // 2. Base slug & regional title variations
    slugs.push(baseSlug);

    if (clean.includes('kagitam') || clean.includes('kaagitham')) {
      slugs.push(baseSlug.replace(/kaagitham|kagitam/g, 'kaagidham'));
      slugs.push(baseSlug.replace(/kaagitham|kagitam/g, 'thella-kaagitham'));
      slugs.push('thella-kaagitham-2021-telugu-full-movie-watch-online-free');
    }
    if (clean.includes('least') || clean.includes('most')) {
      slugs.push(baseSlug.replace(/least/g, 'most'));
      slugs.push(baseSlug.replace(/most/g, 'least'));
      slugs.push('most-eligible-bachelor-2021-telugu-full-movie-watch-online-free');
    }

    return Array.from(new Set(slugs));
  }

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    language?: string;
    languageMode?: string;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1, title = '', languageMode } = params;
    const cleanTitle = (title || '').trim();

    if (cleanTitle) {
      const slugs = this.generateSlugs(cleanTitle, languageMode);
      const primaryDomain = this.mainUrl;

      // Quick candidate check
      const candidate = type === 'tv'
        ? `${primaryDomain}/${slugs[0]}-season-${season}-episode-${episode}/`
        : `${primaryDomain}/${slugs[0]}-movie-watch-online-free/`;

      try {
        const pageBody = await Promise.race([
          this.httpGet(candidate, { Referer: `${primaryDomain}/` }),
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
        ]);
        const stream = await this.extractFromPageBody(pageBody, candidate);
        if (stream) {
          return { ...stream, serverId: this.id, serverName: this.name };
        }
      } catch {
        // Fast fallback to regional embed stream
      }
    }

    // Regional fallback stream (2embed clean endpoint, with correct TV query parameters)
    const fallbackUrl = type === 'tv'
      ? `https://www.2embed.cc/embedtv/${id}?s=${season}&e=${episode}`
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

    // Check var locations or var players JS arrays
    const locationsMatch = body.match(/var\s+(?:locations|players|sources|links)\s*=\s*\[([\s\S]*?)\];/);
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

    // Check embed links in HTML
    const embedMatches = [...body.matchAll(/(https?:\/\/[^"'\s<>]*(?:streamtape|filelions|streamwish|dood|mixdrop|vidoza|vidhide|lulustream|embedrise|dropload|fastream|hls|m3u8|mp4)[^"'\s<>]*)/gi)].map(m => m[1]);
    for (const embedUrl of Array.from(new Set(embedMatches))) {
      if (embedUrl.includes('m3u8') || embedUrl.includes('.mp4')) {
        return {
          url: embedUrl,
          format: 'hls',
          quality: '1080p',
          headers: { Referer: referer, 'User-Agent': this.defaultUserAgent }
        };
      }
      const resolved = await this.resolveFromPage(embedUrl, { referer });
      if (resolved && resolved.url) return resolved;
    }

    return await this.resolveFromPage(referer, { referer, maxDepth: 1, maxPages: 2 });
  }
}
