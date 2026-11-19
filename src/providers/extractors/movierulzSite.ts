// movierulzSite.ts - Reads Movierulz pages: release links in listings, and the stream links of a release.
// The site publishes every language of a title as its own release page, e.g.
//   /kalki-2898-ad-2024-telugu/movie-watch-online-free-3222.html
//   /kalki-2898-ad-2024-hindi/movie-watch-online-free-3224.html
//   /avengers-endgame-encore-2026-hdrip-telugu-dubbed-7752.html

export interface Release {
  url: string;
  /** The site's post number: listings are ordered by it, newest first. */
  id: number;
  /** Title part of the address, e.g. "kalki-2898-ad". */
  name: string;
  year: number;
  /** Display name, e.g. "Telugu". */
  language: string;
}

const LANGUAGE_IN_TAIL = /(?:^|-)(telugu|tamil|hindi|malayalam|kannada|bengali|punjabi|marathi|gujarati|english)(?:-|$)/i;

export function parseRelease(url: string, baseUrl?: string): Release | null {
  let fullUrl = url;
  if (!/^https?:\/\//i.test(url) && baseUrl) {
    try { fullUrl = new URL(url, baseUrl).toString(); } catch { /* keep as is */ }
  }
  const cleanPath = fullUrl.replace(/^https?:\/\/[^/]+/i, '');
  const m = cleanPath.match(/^\/([a-z0-9-]+?)(?:\/(?:movie-)?watch-online-free)?-(\d+)\.html$/i)
    || cleanPath.match(/^\/([a-z0-9-]+?)-(\d+)\.html$/i);
  if (!m) return null;
  const parts = m[1].toLowerCase().match(/^(.+)-((?:19|20)\d\d)-(.+)$/);
  if (!parts) return null;
  const lang = parts[3].match(LANGUAGE_IN_TAIL);
  if (!lang) return null;
  const displayLang = lang[1][0].toUpperCase() + lang[1].slice(1).toLowerCase();
  return {
    url: fullUrl,
    id: parseInt(m[2], 10),
    name: parts[1],
    year: parseInt(parts[2], 10),
    language: displayLang
  };
}

/**
 * The releases a page lists, in page order. Accepts both absolute and relative links.
 */
export function parseReleases(html: string, listOnly = false, baseUrl?: string): Release[] {
  let body = html;
  if (listOnly) {
    const start = html.indexOf('id="list"');
    const end = html.indexOf('class="pagination"', Math.max(start, 0));
    if (start >= 0) body = html.slice(start, end > start ? end : undefined);
  }
  const found = new Map<string, Release>();
  for (const m of body.matchAll(/href\s*=\s*["']([^"'\s]+?-\d+\.html)["']/gi)) {
    const release = parseRelease(m[1], baseUrl);
    if (release && !found.has(release.url)) found.set(release.url, release);
  }
  return [...found.values()];
}

export function slugOf(title: string): string {
  return title
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The releases of one title among `releases`, one per language.
 */
export function releasesOf(releases: Release[], title: string, year?: number): Release[] {
  const slug = slugOf(title);
  if (!slug) return [];
  const sameYear = releases.filter(r => !year || Math.abs(r.year - year) <= 1);
  const exact = sameYear.filter(r => r.name === slug);
  const loose = sameYear.filter(r =>
    r.name === slug ||
    r.name.startsWith(slug + '-') ||
    slug.startsWith(r.name + '-')
  );
  const pool = exact.length ? exact : loose;
  const perLanguage = new Map<string, Release>();
  for (const r of pool) if (!perLanguage.has(r.language)) perLanguage.set(r.language, r);
  return [...perLanguage.values()];
}

/** The player links of a release page (its "stream" buttons), in page order. */
export function streamLinks(html: string): string[] {
  const links: string[] = [];
  for (const tag of html.match(/<a\b[^>]*\bstream-link-btn\b[^>]*>/gi) ?? []) {
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1].replace(/&amp;/g, '&').replace(/\s+/g, '');
    if (href && /^https?:\/\//i.test(href) && !links.includes(href)) links.push(href);
  }
  return links;
}
