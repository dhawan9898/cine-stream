// movierulzSite.ts - Reads Movierulz pages: release links in listings, and the stream links of a release.
// The site publishes every language of a title as its own release page, e.g.
//   /kalki-2898-ad-2024-telugu/movie-watch-online-free-3222.html
//   /kalki-2898-ad-2024-hindi/movie-watch-online-free-3224.html
//   /avengers-endgame-encore-2026-hdrip-telugu-dubbed-7752.html
// Pure functions; no network access here.

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

const LANGUAGE_IN_TAIL = /(?:^|-)(telugu|tamil|hindi|malayalam|kannada|bengali|punjabi|marathi|gujarati|english)(?:-|$)/;
const RELEASE_URL = /^https?:\/\/[^/]+\/([a-z0-9-]+?)(?:\/movie-watch-online-free)?-(\d+)\.html$/i;

export function parseRelease(url: string): Release | null {
  const m = url.match(RELEASE_URL);
  if (!m) return null;
  // Greedy title: the year is the last one in the address ("blade-runner-2049-2017-hindi").
  const parts = m[1].toLowerCase().match(/^(.+)-((?:19|20)\d\d)-(.+)$/);
  if (!parts) return null;
  const lang = parts[3].match(LANGUAGE_IN_TAIL);
  if (!lang) return null;
  return {
    url,
    id: parseInt(m[2], 10),
    name: parts[1],
    year: parseInt(parts[2], 10),
    language: lang[1][0].toUpperCase() + lang[1].slice(1)
  };
}

/**
 * The releases a page lists, in page order. A category page also shows "latest" boxes around its list;
 * with `listOnly` just the list itself is read, so the order and the id range are those of the category.
 */
export function parseReleases(html: string, listOnly = false): Release[] {
  let body = html;
  if (listOnly) {
    const start = html.indexOf('id="list"');
    const end = html.indexOf('class="pagination"', Math.max(start, 0));
    if (start >= 0) body = html.slice(start, end > start ? end : undefined);
  }
  const found = new Map<string, Release>();
  for (const m of body.matchAll(/href\s*=\s*["'](https?:\/\/[^"'\s]+?-\d+\.html)["']/gi)) {
    if (found.has(m[1])) continue;
    const release = parseRelease(m[1]);
    if (release) found.set(m[1], release);
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
 * The releases of one title among `releases`, one per language. An exact title match beats a partial
 * one ("pushpa-2-the-rule" also finds "pushpa-2-the-rule-reloaded", but not when the exact one is there).
 */
export function releasesOf(releases: Release[], title: string, year?: number): Release[] {
  const slug = slugOf(title);
  if (!slug) return [];
  const sameYear = releases.filter(r => !year || Math.abs(r.year - year) <= 1);
  const exact = sameYear.filter(r => r.name === slug);
  const loose = sameYear.filter(r => r.name.startsWith(slug + '-') || slug.startsWith(r.name + '-'));
  const perLanguage = new Map<string, Release>();
  for (const r of exact.length ? exact : loose) if (!perLanguage.has(r.language)) perLanguage.set(r.language, r);
  return [...perLanguage.values()];
}

/** The player links of a release page (its "stream" buttons), in page order. */
export function streamLinks(html: string): string[] {
  const links: string[] = [];
  for (const tag of html.match(/<a\b[^>]*\bstream-link-btn\b[^>]*>/gi) ?? []) {
    // Some pages have a stray line break inside the address.
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1].replace(/&amp;/g, '&').replace(/\s+/g, '');
    if (href && /^https?:\/\//i.test(href) && !links.includes(href)) links.push(href);
  }
  return links;
}
