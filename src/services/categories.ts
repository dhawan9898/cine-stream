// categories.ts - One catalogue of languages, genres and moods shared by Home,
// the Categories picker and Browse. Every category can be shown as movies, TV
// or both at once (movie + TV results interleaved), and can be narrowed by
// language, so rows are not tied to a single query.
import { discoverMedia, type MediaItem, type MediaType } from '../core/cineHypeCore.ts';
import type { BrowseSource, SortBy } from './browseSources.ts';

export type TypeFilter = 'all' | MediaType;
export type CategoryGroup = 'language' | 'genre' | 'mood';

export interface Category {
  key: string;
  name: string;
  group: CategoryGroup;
  // TMDB genre ids per media type ("a,b" = both, "a|b" = either). A side that
  // is missing means that type has no equivalent and is skipped.
  movie?: string;
  tv?: string;
  // Original-language filter (languages, anime).
  language?: string;
}

export const LANGUAGES: Category[] = [
  { key: 'lang-te', name: 'Telugu', group: 'language', language: 'te', movie: '', tv: '' },
  { key: 'lang-hi', name: 'Hindi', group: 'language', language: 'hi', movie: '', tv: '' },
  { key: 'lang-ta', name: 'Tamil', group: 'language', language: 'ta', movie: '', tv: '' },
  { key: 'lang-ml', name: 'Malayalam', group: 'language', language: 'ml', movie: '', tv: '' },
  { key: 'lang-kn', name: 'Kannada', group: 'language', language: 'kn', movie: '', tv: '' },
  { key: 'lang-bn', name: 'Bengali', group: 'language', language: 'bn', movie: '', tv: '' },
  { key: 'lang-pa', name: 'Punjabi', group: 'language', language: 'pa', movie: '', tv: '' },
  { key: 'lang-ko', name: 'Korean', group: 'language', language: 'ko', movie: '', tv: '' },
  { key: 'lang-ja', name: 'Japanese', group: 'language', language: 'ja', movie: '', tv: '' },
  { key: 'lang-en', name: 'English', group: 'language', language: 'en', movie: '', tv: '' }
];

export const GENRES: Category[] = [
  { key: 'action', name: 'Action', group: 'genre', movie: '28', tv: '10759' },
  { key: 'adventure', name: 'Adventure', group: 'genre', movie: '12' },
  { key: 'animation', name: 'Animation', group: 'genre', movie: '16', tv: '16' },
  { key: 'comedy', name: 'Comedy', group: 'genre', movie: '35', tv: '35' },
  { key: 'crime', name: 'Crime', group: 'genre', movie: '80', tv: '80' },
  { key: 'documentary', name: 'Documentary', group: 'genre', movie: '99', tv: '99' },
  { key: 'drama', name: 'Drama', group: 'genre', movie: '18', tv: '18' },
  { key: 'family', name: 'Family', group: 'genre', movie: '10751', tv: '10751' },
  { key: 'fantasy', name: 'Fantasy', group: 'genre', movie: '14' },
  { key: 'history', name: 'History', group: 'genre', movie: '36' },
  { key: 'horror', name: 'Horror', group: 'genre', movie: '27' },
  { key: 'kids', name: 'Kids', group: 'genre', tv: '10762' },
  { key: 'music', name: 'Music', group: 'genre', movie: '10402' },
  { key: 'mystery', name: 'Mystery', group: 'genre', movie: '9648', tv: '9648' },
  { key: 'reality', name: 'Reality', group: 'genre', tv: '10764' },
  { key: 'romance', name: 'Romance', group: 'genre', movie: '10749' },
  { key: 'scifi', name: 'Sci-Fi', group: 'genre', movie: '878', tv: '10765' },
  { key: 'thriller', name: 'Thriller', group: 'genre', movie: '53' },
  { key: 'war', name: 'War', group: 'genre', movie: '10752', tv: '10768' },
  { key: 'western', name: 'Western', group: 'genre', movie: '37', tv: '37' }
];

export const MOODS: Category[] = [
  { key: 'feel-good', name: 'Feel-Good', group: 'mood', movie: '35|10749|10751', tv: '35|10751' },
  { key: 'edge-of-seat', name: 'Edge of Your Seat', group: 'mood', movie: '53|80|9648', tv: '80|9648' },
  { key: 'mind-bending', name: 'Mind-Bending', group: 'mood', movie: '878|9648', tv: '10765|9648' },
  { key: 'family-night', name: 'Family Night', group: 'mood', movie: '10751|16', tv: '10751|16' },
  { key: 'dark-gritty', name: 'Dark & Gritty', group: 'mood', movie: '80,18', tv: '80,18' },
  { key: 'anime', name: 'Anime', group: 'mood', language: 'ja', movie: '16', tv: '16' }
];

export const ALL_CATEGORIES: Category[] = [...LANGUAGES, ...GENRES, ...MOODS];
const BY_KEY = new Map(ALL_CATEGORIES.map(c => [c.key, c]));
export const getCategory = (key: string): Category | undefined => BY_KEY.get(key);

// TMDB genre id -> genre category, for learning taste from watch history.
const GENRE_BY_ID = new Map<number, Category>();
for (const g of GENRES) {
  for (const id of [g.movie, g.tv]) {
    if (id && /^\d+$/.test(id)) GENRE_BY_ID.set(Number(id), g);
  }
}
export const genreCategoryForId = (id: number): Category | undefined => GENRE_BY_ID.get(id);

const supports = (c: Category, type: MediaType) => (type === 'movie' ? c.movie : c.tv) !== undefined;
export const categorySupports = (c: Category, filter: TypeFilter) =>
  filter === 'all' ? supports(c, 'movie') || supports(c, 'tv') : supports(c, filter);

const interleave = (a: MediaItem[], b: MediaItem[]): MediaItem[] => {
  const out: MediaItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    for (const m of [a[i], b[i]]) {
      if (!m) continue;
      const k = `${m.mediaType}-${m.id}`;
      if (!seen.has(k)) { seen.add(k); out.push(m); }
    }
  }
  return out;
};

// A browse source for a category, optionally narrowed to a language (so
// "Telugu" + "Action" gives Telugu action) and to movies or TV.
export function categorySource(category: Category, filter: TypeFilter = 'all', opts: { language?: Category; title?: string } = {}): BrowseSource {
  const language = opts.language?.language ?? category.language;
  const kinds = (filter === 'all' ? (['movie', 'tv'] as MediaType[]) : [filter]).filter(t => supports(category, t));
  const suffix = filter === 'movie' ? ' Movies' : filter === 'tv' ? ' TV Shows' : '';
  const base = opts.language ? `${opts.language.name} ${category.name}` : category.name;
  return {
    key: `cat-${filter}-${category.key}${opts.language ? `-${opts.language.key}` : ''}`,
    title: opts.title ?? (category.group === 'language' && filter === 'all' ? `${base} Movies & Shows` : `${base}${suffix}`),
    category: { key: category.key, filter },
    load: async (page: number, sortBy: SortBy) => {
      const lists = await Promise.all(
        kinds.map(type =>
          discoverMedia({ type, genres: (type === 'movie' ? category.movie : category.tv) || undefined, language, page, sortBy }).catch(() => [] as MediaItem[])
        )
      );
      return lists.length === 2 ? interleave(lists[0], lists[1]) : (lists[0] ?? []);
    }
  };
}
