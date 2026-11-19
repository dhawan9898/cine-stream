// movierulzExtractor.ts - Indian regional content extractor (Telugu, Hindi, Tamil, Malayalam, dubbed releases).
//
// Movierulz publishes each language of a title as its own release page, so the audio choices of a
// title are its release pages: all of them are found, one stream is resolved per language, and the
// player lists them under Audio.
import { BaseExtractor } from './baseExtractor.ts';
import type { AudioVariant, ExtractedStream, SourceManifest } from './types.ts';
import { LANGUAGE_NAMES } from './variantDiscovery.ts';
import { parseReleases, releasesOf, streamLinks, type Release } from './movierulzSite.ts';
import { TtlStore } from '../sources/ttlStore.ts';

const PAGE_TIMEOUT_MS = 2500;
const HOSTER_TIMEOUT_MS = 3500;
// A year of one language is some 30-45 listing pages of 16 titles.
const MAX_LISTING_PAGES = 48;
const PAGES_PER_WAVE = 8;
// Releases of one title are posted close together; their post numbers differ by up to a few pages.
const SIBLING_PAGE_SPREAD = 3;
const FOUND_TTL_MS = 7 * 24 * 60 * 60_000;
const NOT_FOUND_TTL_MS = 3 * 60 * 60_000;

// Listing of a year's releases per language ("bollywood" is Hindi, "hollywood" English originals;
// dubbed releases are listed under the language they are dubbed in).
const CATEGORY_OF: Record<string, string> = {
  te: 'telugu', ta: 'tamil', hi: 'bollywood', ml: 'malayalam',
  kn: 'kannada', bn: 'bengali', pa: 'punjabi', mr: 'marathi', gu: 'gujarati', en: 'hollywood'
};
const REGIONAL_CATEGORIES = ['telugu', 'bollywood', 'tamil', 'malayalam', 'kannada', 'bengali', 'punjabi', 'marathi', 'gujarati'];

// Players whose page gives up the stream to a plain request, best first. Every language of a title is
// taken from the same player, so one set of request headers plays all of them.
// `plainHeaders`: its CDN refuses requests that carry an Origin header (the player page's address is enough).
const HOSTERS: Array<{ match: RegExp; plainHeaders?: boolean }> = [
  { match: /\bvcdnlare\./i, plainHeaders: true },
  { match: /\bminochinos\./i }
];

export class MovierulzExtractor extends BaseExtractor {
  id = 'movierulz';
  name = 'Movierulz Regional';
  mainUrl = 'https://www.5movierulz.app';
  // Older addresses forward to the current one.
  private mirrors = [
    'https://www.5movierulz.app',
    'https://ww1.movierulz.ch',
    'https://www.5movierulz.be',
    'https://www.5movierulz.ms',
    'https://www.5movierulz.dentist',
    'https://www.5movierulz.gratis',
    'https://5movierulz.voto',
    'https://www.5movierulz.camera'
  ];
  // Indian-language catalog found by title (several page loads): waited for on those titles, for their
  // other languages; the main stream comes from the other providers when they have the title.
  manifest = { idKind: 'search', costHint: 'multi-hop', priorMs: 5000, strongFor: { languages: ['te', 'hi', 'ta', 'ml', 'kn', 'pa', 'bn'] }, trust: 'scraper', languagesOnly: true } satisfies SourceManifest;

  private origin: Promise<string | null> | null = null;
  private listings = new Map<string, Promise<Release[]>>();
  private pages = new Map<string, Promise<string[]>>();
  private found = new TtlStore<Release[]>('cs_movierulz_titles', 300);

  applyConfig(override: { mainUrl?: string; mirrors?: string[] }): void {
    super.applyConfig(override);
    if (override.mirrors?.length) this.mirrors = override.mirrors;
    this.origin = null;
    this.listings.clear();
  }

  private async get(url: string, referer: string, signal?: AbortSignal, timeoutMs = PAGE_TIMEOUT_MS): Promise<string | null> {
    if (signal?.aborted) return null;
    try {
      return await this.httpGet(url, { Referer: referer }, { signal, timeoutMs });
    } catch {
      return null;
    }
  }

  /** The site's current address: the first of mainUrl / mirrors that answers, read from its own links. */
  private siteOrigin(signal?: AbortSignal): Promise<string | null> {
    this.origin ??= (async () => {
      for (const base of [this.mainUrl, ...this.mirrors]) {
        const body = await this.get(`${base}/`, `${base}/`, signal, 4000);
        const own = body?.match(/href\s*=\s*["'](https?:\/\/[^"'/]*movierulz[^"'/]*)\/(?:category|language)\//i)?.[1];
        if (own) return own;
        if (signal?.aborted) break;
      }
      this.origin = null; // not reachable now: look again on the next title
      return null;
    })();
    return this.origin;
  }

  /** One page of a language's releases of a year (kept for the session: titles are looked up in them again). */
  private listing(origin: string, category: string, year: number, page: number, signal?: AbortSignal): Promise<Release[]> {
    const key = `${category}-${year}/${page}`;
    let pending = this.listings.get(key);
    if (!pending) {
      pending = (async () => {
        const body = await this.get(`${origin}/category/${category}-movies-${year}/page/${page}`, `${origin}/`, signal);
        if (body === null) {
          this.listings.delete(key);
          return [];
        }
        // Past its last page a category shows the site's latest releases instead: other years.
        return parseReleases(body, true, origin).filter(r => Math.abs(r.year - year) <= 1);
      })();
      this.listings.set(key, pending);
    }
    return pending;
  }

  /** Walks a category from its newest page until the title turns up. */
  private async scanCategory(origin: string, category: string, title: string, year: number, signal?: AbortSignal): Promise<Release[]> {
    for (let first = 1; first <= MAX_LISTING_PAGES && !signal?.aborted; first += PAGES_PER_WAVE) {
      const wave = await Promise.all(
        Array.from({ length: PAGES_PER_WAVE }, (_, i) => this.listing(origin, category, year, first + i, signal))
      );
      const hits = releasesOf(wave.flat(), title, year);
      if (hits.length) return hits;
      if (wave.some(page => page.length === 0)) break; // ran off the end of the category
    }
    return [];
  }

  /** The title in another language's category: its page is found from the post number of a known release. */
  private async findSibling(origin: string, category: string, title: string, year: number, nearId: number, signal?: AbortSignal): Promise<Release[]> {
    let low = 1;
    let high = MAX_LISTING_PAGES;
    let at = 0;
    while (low <= high && !signal?.aborted) {
      const mid = (low + high) >> 1;
      const page = await this.listing(origin, category, year, mid, signal);
      if (page.length === 0) { high = mid - 1; continue; }
      const ids = page.map(r => r.id);
      if (nearId > Math.max(...ids)) high = mid - 1;
      else if (nearId < Math.min(...ids)) low = mid + 1;
      else { at = mid; break; }
    }
    if (!at) at = Math.max(1, Math.min(low, MAX_LISTING_PAGES));
    const around = await Promise.all(
      Array.from({ length: SIBLING_PAGE_SPREAD * 2 + 1 }, (_, i) => at - SIBLING_PAGE_SPREAD + i)
        .filter(page => page >= 1)
        .map(page => this.listing(origin, category, year, page, signal))
    );
    return releasesOf(around.flat(), title, year);
  }

  /** Every language release of a title. */
  private async findReleases(title: string, year: number | undefined, language: string | undefined, signal?: AbortSignal): Promise<Release[]> {
    const key = `${title.toLowerCase()}|${year ?? ''}`;
    const known = this.found.get(key);
    if (known.has && known.value) return known.value;

    const origin = await this.siteOrigin(signal);
    if (!origin || signal?.aborted) return [];

    // Clean search title (remove colons, dashes, extra spaces)
    const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();

    // The site's own search lists every language at once, when it lets a plain request through.
    let search = await this.get(`${origin}/search_movies?s=${encodeURIComponent(cleanTitle)}`, `${origin}/`, signal, 3500);
    if (!search && cleanTitle !== title) {
      search = await this.get(`${origin}/search_movies?s=${encodeURIComponent(title)}`, `${origin}/`, signal, 3500);
    }
    let releases = search ? releasesOf(parseReleases(search, false, origin), title, year) : [];
    if (releases.length === 0 && search) {
      releases = releasesOf(parseReleases(search, false, origin), cleanTitle, year);
    }

    if (releases.length === 0 && year && year >= 2015) {
      const own = CATEGORY_OF[(language ?? '').toLowerCase()];
      const first = own ? [own] : REGIONAL_CATEGORIES.slice(0, 2);
      releases = (await Promise.all(first.map(c => this.scanCategory(origin, c, cleanTitle, year, signal)))).flat();
      if (releases.length > 0) {
        const others = REGIONAL_CATEGORIES.filter(c => !first.includes(c));
        const siblings = await Promise.all(others.map(c => this.findSibling(origin, c, cleanTitle, year, releases[0].id, signal)));
        releases = releasesOf([...releases, ...siblings.flat()], cleanTitle, year);
      }
    }
    if (!signal?.aborted) this.found.set(key, releases, releases.length ? FOUND_TTL_MS : NOT_FOUND_TTL_MS);
    return releases;
  }

  private playerLinks(release: Release, signal?: AbortSignal): Promise<string[]> {
    let pending = this.pages.get(release.url);
    if (!pending) {
      pending = (async () => {
        const body = await this.get(release.url, new URL(release.url).origin + '/', signal);
        if (body === null) this.pages.delete(release.url);
        return body ? streamLinks(body) : [];
      })();
      this.pages.set(release.url, pending);
    }
    return pending;
  }

  private async resolveRelease(release: Release, hoster: (typeof HOSTERS)[number], signal?: AbortSignal): Promise<ExtractedStream | null> {
    const link = (await this.playerLinks(release, signal)).find(l => hoster.match.test(l));
    if (!link || signal?.aborted) return null;
    try {
      const stream = await this.resolveFromPage(link, { referer: release.url, maxDepth: 2, maxPages: 3, signal, timeoutMs: HOSTER_TIMEOUT_MS });
      if (stream && hoster.plainHeaders) stream.headers = { Referer: new URL(link).origin + '/', 'User-Agent': this.defaultUserAgent };
      return stream;
    } catch {
      return null;
    }
  }

  /** The stream of the wanted language, with the other languages of the title as audio choices. */
  private async streamOf(releases: Release[], languageCode: string | undefined, signal?: AbortSignal): Promise<ExtractedStream | null> {
    const wanted = languageCode ? LANGUAGE_NAMES[languageCode.toLowerCase()] : undefined;
    const primary = releases.find(r => r.language === wanted) ?? releases[0];
    for (const hoster of HOSTERS) {
      if (signal?.aborted) return null;
      const streams = await Promise.all(releases.map(r => this.resolveRelease(r, hoster, signal)));
      // Start in the wanted language when this player has it, else in the first one it has.
      const primaryIdx = releases.indexOf(primary);
      const winningIdx = streams[primaryIdx] ? primaryIdx : streams.findIndex(Boolean);
      if (winningIdx === -1) continue;
      const stream = streams[winningIdx];
      if (!stream || !(await this.probe(stream, signal))) continue;

      const actualLang = releases[winningIdx].language;
      const audios: AudioVariant[] = releases.flatMap((r, i) =>
        streams[i] ? [{ label: r.language, language: r.language, url: streams[i]!.url }] : []
      );
      return {
        ...stream,
        audios: audios.length > 0 ? audios : [{ label: actualLang, language: actualLang, url: stream.url }]
      };
    }
    // None of the known players: whatever link of the wanted language resolves, without audio choices.
    for (const link of (await this.playerLinks(primary, signal)).filter(l => !HOSTERS.some(h => h.match.test(l))).slice(0, 3)) {
      if (signal?.aborted) return null;
      const stream = await this.resolveFromPage(link, { referer: primary.url, maxDepth: 2, maxPages: 3, signal, timeoutMs: HOSTER_TIMEOUT_MS }).catch(() => null);
      if (stream && (await this.probe(stream, signal))) {
        return {
          ...stream,
          audios: [{ label: primary.language, language: primary.language, url: stream.url }]
        };
      }
    }
    return null;
  }

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    year?: number;
    language?: string;
    languageMode?: string;
    signal?: AbortSignal;
  }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1, signal } = params;
    if (signal?.aborted) return null;

    // "Kalki 2898 AD (2024)": the year may only be in the title.
    const title = (params.title ?? '').replace(/\s*\((?:19|20)\d\d\)\s*$/, '').trim();
    const year = params.year ?? (parseInt(params.title?.match(/\(((?:19|20)\d\d)\)\s*$/)?.[1] ?? '', 10) || undefined);

    // The site lists films; series go to the embed below.
    if (title && type === 'movie') {
      try {
        const releases = await this.findReleases(title, year, params.language, signal);
        const stream = releases.length ? await this.streamOf(releases, params.language, signal) : null;
        if (stream) return { ...stream, serverId: this.id, serverName: this.name };
      } catch {
        // fall through to the embed
      }
    }
    if (signal?.aborted) return null;

    return {
      url: type === 'tv' ? `https://vidsrc.to/embed/tv/${id}/${season}/${episode}` : `https://vidsrc.to/embed/movie/${id}`,
      format: 'hls',
      isFallbackEmbed: true,
      serverId: this.id,
      serverName: this.name
    };
  }
}
