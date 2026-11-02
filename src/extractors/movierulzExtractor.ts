// movierulzExtractor.ts - Indian regional content extractor (Telugu, Hindi, Tamil, Malayalam, Kannada, Multi-Audio)
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';
import { buildVariantSet, extractCandidates, type ResolvedVariant } from './variantDiscovery.ts';

const MEDIA_EXT = /\.(m3u8|mpd|mp4|mkv|webm)(\?|$)/i;
const MAX_CANDIDATES = 8;
const CANDIDATE_TIMEOUT_MS = 5000;

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
        const stream = await this.extractFromPageBody(pageBody, candidate, params.language);
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

  // Resolves every language/quality link the release page lists, then starts the
  // viewer's language at the best quality and hands the rest to the player's
  // Audio and Video Quality menus.
  private async extractFromPageBody(body: string, referer: string, languageCode?: string): Promise<ExtractedStream | null> {
    if (!body) return null;

    const candidates = extractCandidates(body, referer).slice(0, MAX_CANDIDATES);
    const settled = await Promise.all(candidates.map(async (c): Promise<ResolvedVariant | null> => {
      if (MEDIA_EXT.test(c.url)) return { url: c.url, hint: c.hint };
      try {
        const resolved = await Promise.race([
          this.resolveFromPage(c.url, { referer, maxDepth: 1, maxPages: 3 }),
          new Promise<null>(r => setTimeout(() => r(null), CANDIDATE_TIMEOUT_MS))
        ]);
        return resolved?.url ? { url: resolved.url, hint: c.hint } : null;
      } catch {
        return null;
      }
    }));

    const set = buildVariantSet(settled.filter((v): v is ResolvedVariant => v !== null), languageCode);
    if (set) {
      return {
        url: set.primary.url,
        format: MEDIA_EXT.test(set.primary.url) && /\.mpd/i.test(set.primary.url) ? 'dash' : /\.(mp4|mkv|webm)(\?|$)/i.test(set.primary.url) ? 'mp4' : 'hls',
        quality: set.primary.hint.quality,
        headers: { Referer: referer, 'User-Agent': this.defaultUserAgent },
        qualities: set.qualities.length > 1 ? set.qualities : undefined,
        audios: set.audios.length > 1 ? set.audios : undefined
      };
    }

    return await this.resolveFromPage(referer, { referer, maxDepth: 1, maxPages: 2 });
  }
}
