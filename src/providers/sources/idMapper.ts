// idMapper.ts - TMDB title -> a search-based site's own id, matched carefully and cached for weeks.
//
// Sites like FlixHQ (lobster, flix-cli) or a Jellyfin library only find titles by search. Searching on
// every Play costs a round trip and risks a different match each time, while the answer almost never
// changes. So a title is searched once (English title, then the original-language one), the candidates
// are scored on title, year and kind, and only a confident match is kept: 30 days for a match, 1 day for
// "not on this site". A wrong match is worse than none - it would play the wrong film.
import { TtlStore } from './ttlStore.ts';

export interface TitleRef {
  tmdbId: number;
  type: 'movie' | 'tv';
  title?: string;
  originalTitle?: string;
  year?: number;
}

export interface SiteTitle {
  /** The site's id for the title (whatever its later requests need). */
  siteId: string;
  title: string;
  type: 'movie' | 'tv';
  year?: number;
  /** Anything else a source wants to keep with the match (e.g. FlixHQ's watch path). */
  extra?: Record<string, string>;
  /** Set by a source that matched on an exact external id (e.g. Jellyfin's TMDB provider id). */
  exact?: boolean;
}

const MATCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
/** Below this a candidate is not accepted. */
export const MIN_CONFIDENCE = 0.8;

/** Lower case, accents and punctuation gone, '&' as 'and', a leading article dropped. */
export function normalizeTitle(t: string): string {
  return t
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

/** 1 for the same title, else the bigram overlap (Dice), 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(x);
  const gb = grams(y);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  const total = Math.max(1, x.length - 1 + y.length - 1);
  return (2 * overlap) / total;
}

/** How sure we are that `c` is `ref`: 0 for the wrong kind or a year more than one off. */
export function matchConfidence(c: SiteTitle, ref: TitleRef): number {
  if (c.type !== ref.type) return 0;
  if (c.exact) return 1;
  const names = [ref.title, ref.originalTitle].filter((n): n is string => Boolean(n));
  const sim = Math.max(0, ...names.map(n => titleSimilarity(c.title, n)));
  if (ref.year && c.year) {
    const dy = Math.abs(ref.year - c.year);
    if (dy > 1) return Math.min(sim, 0.5); // a remake or a namesake
    return sim * 0.85 + (dy === 0 ? 0.15 : 0.08);
  }
  // No year to compare: the title alone must be (almost) exact.
  return sim * 0.9;
}

export function bestMatch(candidates: SiteTitle[], ref: TitleRef): { match: SiteTitle; confidence: number } | null {
  let best: { match: SiteTitle; confidence: number } | null = null;
  for (const c of candidates) {
    const confidence = matchConfidence(c, ref);
    if (!best || confidence > best.confidence) best = { match: c, confidence };
  }
  return best && best.confidence >= MIN_CONFIDENCE ? best : null;
}

export class IdMapper {
  private store: TtlStore<SiteTitle | null>;
  private inFlight = new Map<string, Promise<SiteTitle | null>>();

  constructor(storageKey = 'cinestream_id_map_v1', store?: TtlStore<SiteTitle | null>) {
    this.store = store ?? new TtlStore<SiteTitle | null>(storageKey, 3000);
  }

  private key(sourceId: string, ref: TitleRef) {
    return `${sourceId}|${ref.type}|${ref.tmdbId}`;
  }

  /** The cached mapping: a match, null for "known absent", undefined when not looked up yet. */
  cached(sourceId: string, ref: TitleRef): SiteTitle | null | undefined {
    const hit = this.store.get(this.key(sourceId, ref));
    return hit.has ? (hit.value ?? null) : undefined;
  }

  /**
   * The site's title for `ref`, searching with `search` only when nothing is cached. A search that
   * fails (network) caches nothing; one that finds no confident match caches "absent" for a day.
   */
  map(sourceId: string, ref: TitleRef, search: (query: string) => Promise<SiteTitle[]>): Promise<SiteTitle | null> {
    const cached = this.cached(sourceId, ref);
    if (cached !== undefined) return Promise.resolve(cached);
    const key = this.key(sourceId, ref);
    const running = this.inFlight.get(key);
    if (running) return running;
    const work = (async () => {
      const queries = [...new Set([ref.title, ref.originalTitle].filter((q): q is string => Boolean(q && q.trim())))];
      if (queries.length === 0) return null;
      let searched = false;
      for (const q of queries) {
        let candidates: SiteTitle[];
        try {
          candidates = await search(q);
          searched = true;
        } catch {
          continue;
        }
        const best = bestMatch(candidates, ref);
        if (best) {
          this.store.set(key, best.match, MATCH_TTL_MS);
          return best.match;
        }
      }
      if (searched) this.store.set(key, null, MISS_TTL_MS);
      return null;
    })().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  /** The mapped id turned out wrong or gone (e.g. a 404): look it up again next time. */
  forget(sourceId: string, ref: TitleRef): void {
    this.store.delete(this.key(sourceId, ref));
  }
}

export const idMapper = new IdMapper();
