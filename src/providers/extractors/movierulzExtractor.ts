// movierulzExtractor.ts - Indian regional content extractor (Telugu, Hindi, Tamil, Malayalam, Kannada, Multi-Audio)
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream, SourceManifest } from './types.ts';
import { buildVariantSet, extractCandidates, type ResolvedVariant } from './variantDiscovery.ts';

const MEDIA_EXT = /\.(m3u8|mpd|mp4|mkv|webm)(\?|$)/i;
const MAX_CANDIDATES = 6;
const CANDIDATE_TIMEOUT_MS = 1800;

export class MovierulzExtractor extends BaseExtractor {
  id = 'movierulz';
  name = 'Movierulz Regional';
  mainUrl = 'https://ww10.7movierulz.so';
  private mirrors = ['https://ww10.7movierulz.so', 'https://7movierulz.so', 'https://ww3.7movierulz.tc', 'https://movierulz.lat'];
  // Indian-language catalog found by title (several page loads): ranked ahead for those titles only.
  manifest = { idKind: 'search', costHint: 'multi-hop', priorMs: 5000, strongFor: { languages: ['te', 'hi', 'ta', 'ml', 'kn', 'pa', 'bn'] }, trust: 'scraper' } satisfies SourceManifest;

  private generateSlugs(title: string, languageMode?: string, year?: number, language?: string): string[] {
    if (!title) return [];
    // Extract year from title like "Kalki 2898 AD (2024)" if present
    const yearMatch = title.match(/\b(19\d\d|20\d\d)\b/);
    const parsedYear = year || (yearMatch ? parseInt(yearMatch[1], 10) : undefined);
    const clean = title.replace(/\b(19\d\d|20\d\d)\b/g, '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
    const baseSlug = clean.replace(/\s+/g, '-');
    const slugs: string[] = [];

    // 1. Year and regional language specific slugs (most common on MovieRulz)
    const lang = (language || '').toLowerCase();
    if (parsedYear) {
      if (lang === 'te') slugs.push(`${baseSlug}-${parsedYear}-telugu-movie-watch-online-free`, `${baseSlug}-${parsedYear}-telugu`);
      if (lang === 'ta') slugs.push(`${baseSlug}-${parsedYear}-tamil-movie-watch-online-free`, `${baseSlug}-${parsedYear}-tamil`);
      if (lang === 'hi') slugs.push(`${baseSlug}-${parsedYear}-hindi-movie-watch-online-free`, `${baseSlug}-${parsedYear}-hindi`);
      slugs.push(`${baseSlug}-${parsedYear}-movie-watch-online-free`, `${baseSlug}-${parsedYear}`);
    }

    // 2. Multi-audio & Multi-language priority slugs
    if (languageMode === 'multi' || !languageMode || languageMode === 'sub' || languageMode === 'dub') {
      slugs.push(`${baseSlug}-multi-audio`);
      slugs.push(`${baseSlug}-dual-audio`);
    }

    // 3. Base slug & watch-online slug
    slugs.push(`${baseSlug}-movie-watch-online-free`);
    slugs.push(baseSlug);

    return Array.from(new Set(slugs));
  }

  private async fetchWithin(url: string, ms: number, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.httpGet(url, { Referer: `${this.mainUrl}/` }, { signal, timeoutMs: ms }),
        new Promise<null>(r => { timer = setTimeout(() => r(null), ms); })
      ]);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async findReleasePages(
    title: string, slugs: string[], type: 'movie' | 'tv', season: number, episode: number, signal?: AbortSignal
  ): Promise<Array<{ url: string; body: string }>> {
    const urls = slugs.slice(0, 3).map(slug => type === 'tv'
      ? `${this.mainUrl}/${slug}-season-${season}-episode-${episode}/`
      : `${this.mainUrl}/${slug}-movie-watch-online-free/`);

    const guessed = await Promise.all(urls.map(async url => ({ url, body: await this.fetchWithin(url, 1800, signal) })));
    const pages = guessed.filter((p): p is { url: string; body: string } => Boolean(p.body && p.body.length > 500));

    if (pages.length === 0 && !signal?.aborted) {
      const search = await this.fetchWithin(`${this.mainUrl}/?s=${encodeURIComponent(title)}`, 1800, signal);
      if (search) {
        const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
        const links = [...search.matchAll(/<a\b[^>]*?href\s*=\s*["'](https?:\/\/[^"']*movierulz[^"']+)["']/gi)]
          .map(m => m[1])
          .filter(u => { const l = u.toLowerCase(); return words.length > 0 && words.every(w => l.includes(w)) && !/[?#]|\/(category|tag|page)\//.test(l); });
        const ranked = [...new Set(links)].sort((a, b) => Number(/multi|dual/i.test(b)) - Number(/multi|dual/i.test(a))).slice(0, 2);
        const found = await Promise.all(ranked.map(async url => ({ url, body: await this.fetchWithin(url, 1800, signal) })));
        pages.push(...found.filter((p): p is { url: string; body: string } => Boolean(p.body)));
      }
    }
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
    signal?: AbortSignal;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1, title = '', languageMode, signal } = params;
    if (signal?.aborted) return null;

    const cleanTitle = (title || '').trim();

    if (cleanTitle) {
      const slugs = this.generateSlugs(cleanTitle, languageMode, (params as any).year, params.language);
      const pages = await this.findReleasePages(cleanTitle, slugs, type, season, episode, signal);
      for (const page of pages) {
        if (signal?.aborted) break;
        try {
          const stream = await this.extractFromPageBody(page.body, page.url, params.language, signal);
          if (stream) return { ...stream, serverId: this.id, serverName: this.name };
        } catch {
          // try the next candidate page
        }
      }
    }

    const fallbackUrl = type === 'tv'
      ? `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`
      : `https://vidsrc.to/embed/movie/${id}`;

    return {
      url: fallbackUrl,
      format: 'hls',
      isFallbackEmbed: true,
      serverId: this.id,
      serverName: this.name
    };
  }

  private async extractFromPageBody(body: string, referer: string, languageCode?: string, signal?: AbortSignal): Promise<ExtractedStream | null> {
    if (!body || signal?.aborted) return null;

    const candidates = extractCandidates(body, referer).slice(0, MAX_CANDIDATES);
    const settled = await Promise.all(candidates.map(async (c): Promise<ResolvedVariant | null> => {
      if (MEDIA_EXT.test(c.url)) return { url: c.url, hint: c.hint };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const resolved = await Promise.race([
          this.resolveFromPage(c.url, { referer, maxDepth: 1, maxPages: 2, signal, timeoutMs: CANDIDATE_TIMEOUT_MS }),
          new Promise<null>(r => { timer = setTimeout(() => r(null), CANDIDATE_TIMEOUT_MS); })
        ]);
        return resolved?.url ? { url: resolved.url, hint: c.hint } : null;
      } catch {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }));

    const set = buildVariantSet(settled.filter((v): v is ResolvedVariant => v !== null), languageCode);
    if (set) {
      const found: ExtractedStream = {
        url: set.primary.url,
        format: MEDIA_EXT.test(set.primary.url) && /\.mpd/i.test(set.primary.url) ? 'dash' : /\.(mp4|mkv)(\?|$)/i.test(set.primary.url) ? 'mp4' : 'hls',
        quality: set.primary.hint.quality,
        headers: { Referer: referer, 'User-Agent': this.defaultUserAgent },
        qualities: set.qualities.length > 1 ? set.qualities : undefined,
        audios: set.audios.length > 1 ? set.audios : undefined
      };
      if (await this.probe(found, signal)) {
        return found;
      }
    }

    return await this.resolveFromPage(referer, { referer, maxDepth: 1, maxPages: 2, signal, timeoutMs: CANDIDATE_TIMEOUT_MS });
  }
}
