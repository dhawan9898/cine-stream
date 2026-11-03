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

  private async fetchWithin(url: string, ms: number): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.httpGet(url, { Referer: `${this.mainUrl}/` }),
        new Promise<null>(r => { timer = setTimeout(() => r(null), ms); })
      ]);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Release pages for a title: guessed slug URLs (multi-audio first) fetched in
  // parallel, plus the site's own search results, so titles whose slug we
  // cannot guess still resolve to the multi-language page.
  private async findReleasePages(
    title: string, slugs: string[], type: 'movie' | 'tv', season: number, episode: number
  ): Promise<Array<{ url: string; body: string }>> {
    const urls = slugs.slice(0, 4).map(slug => type === 'tv'
      ? `${this.mainUrl}/${slug}-season-${season}-episode-${episode}/`
      : `${this.mainUrl}/${slug}-movie-watch-online-free/`);

    const guessed = await Promise.all(urls.map(async url => ({ url, body: await this.fetchWithin(url, 4000) })));
    const pages = guessed.filter((p): p is { url: string; body: string } => Boolean(p.body && p.body.length > 500));

    if (pages.length === 0) {
      const search = await this.fetchWithin(`${this.mainUrl}/?s=${encodeURIComponent(title)}`, 4000);
      if (search) {
        const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
        const links = [...search.matchAll(/<a\b[^>]*?href\s*=\s*["'](https?:\/\/[^"']*movierulz[^"']+)["']/gi)]
          .map(m => m[1])
          .filter(u => { const l = u.toLowerCase(); return words.length > 0 && words.every(w => l.includes(w)) && !/[?#]|\/(category|tag|page)\//.test(l); });
        // Multi-audio releases first.
        const ranked = [...new Set(links)].sort((a, b) => Number(/multi|dual/i.test(b)) - Number(/multi|dual/i.test(a))).slice(0, 3);
        const found = await Promise.all(ranked.map(async url => ({ url, body: await this.fetchWithin(url, 4000) })));
        pages.push(...found.filter((p): p is { url: string; body: string } => Boolean(p.body)));
      }
    }
    // Pages that advertise several languages go first.
    const score = (b: string, u: string) => (/multi|dual/i.test(u) ? 2 : 0) + (b.match(/\b(telugu|tamil|hindi|malayalam|kannada)\b/gi)?.length ? 1 : 0);
    return pages.sort((a, b) => score(b.body, b.url) - score(a.body, a.url));
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
      const pages = await this.findReleasePages(cleanTitle, slugs, type, season, episode);
      for (const page of pages) {
        try {
          const stream = await this.extractFromPageBody(page.body, page.url, params.language);
          if (stream) return { ...stream, serverId: this.id, serverName: this.name };
        } catch {
          // try the next candidate page
        }
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
