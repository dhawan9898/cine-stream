// browseSources.ts - Describes the lists a Browse page can show (a genre, or
// one of Home's rails), so a single screen handles all of them.
import {
  discoverByGenre,
  discoverByLanguage,
  getPopularMovies,
  getPopularTV,
  getTopRatedMovies,
  getTopRatedTV,
  getTrending,
  getOnTheAirTV,
  type Genre,
  type MediaItem,
  type MediaType
} from '../core/cineHypeCore.ts';

export type SortBy = 'popularity.desc' | 'vote_average.desc' | 'primary_release_date.desc';

export const SORT_OPTIONS: { id: SortBy; label: string }[] = [
  { id: 'popularity.desc', label: 'Popular' },
  { id: 'vote_average.desc', label: 'Top Rated' },
  { id: 'primary_release_date.desc', label: 'Newest' }
];

export interface BrowseSource {
  key: string;
  title: string;
  // Present for genre pages only: lets the Categories switcher highlight it.
  genre?: { id: number; type: MediaType };
  load: (page: number, sortBy: SortBy) => Promise<MediaItem[]>;
}

export const genreSource = (genre: Genre, type: MediaType): BrowseSource => {
  // Regional category mapping
  if (genre.id === 2001) return languageSource({ code: 'te', name: 'Telugu' }, type);
  if (genre.id === 2002) return languageSource({ code: 'ta', name: 'Tamil' }, type);
  if (genre.id === 2003) return languageSource({ code: 'hi', name: 'Hindi' }, type);
  if (genre.id === 2004) return languageSource({ code: 'ml', name: 'Malayalam' }, type);
  if (genre.id === 2005) return languageSource({ code: 'kn', name: 'Kannada' }, type);

  return {
    key: `genre-${type}-${genre.id}`,
    title: `${genre.name} ${type === 'movie' ? 'Movies' : 'TV'}`,
    genre: { id: genre.id, type },
    load: (page, sortBy) => discoverByGenre(genre.id, type, page, sortBy)
  };
};

export const languageSource = (lang: { code: string; name: string }, type: MediaType): BrowseSource => ({
  key: `lang-${type}-${lang.code}`,
  title: `${lang.name} ${type === 'movie' ? 'Movies' : 'TV Shows'}`,
  genre: { id: lang.code === 'te' ? 2001 : lang.code === 'ta' ? 2002 : lang.code === 'hi' ? 2003 : 2004, type },
  load: (page, sortBy) => discoverByLanguage(lang.code, type, page, sortBy)
});

export const TELUGU_MOVIES: BrowseSource = languageSource({ code: 'te', name: 'Telugu' }, 'movie');
export const TAMIL_MOVIES: BrowseSource = languageSource({ code: 'ta', name: 'Tamil' }, 'movie');
export const HINDI_MOVIES: BrowseSource = languageSource({ code: 'hi', name: 'Hindi' }, 'movie');
export const MALAYALAM_MOVIES: BrowseSource = languageSource({ code: 'ml', name: 'Malayalam' }, 'movie');
export const KANNADA_MOVIES: BrowseSource = languageSource({ code: 'kn', name: 'Kannada' }, 'movie');

export const POPULAR_MOVIES: BrowseSource = { key: 'popular-movies', title: 'Popular Movies', load: getPopularMovies };
export const POPULAR_TV: BrowseSource = { key: 'popular-tv', title: 'Popular TV Shows', load: getPopularTV };
export const TOP_RATED_MOVIES: BrowseSource = { key: 'top-rated', title: 'Top Rated Movies', load: getTopRatedMovies };
export const ON_THE_AIR: BrowseSource = { key: 'on-the-air', title: 'New Episodes On The Air', load: getOnTheAirTV };
export const TOP_RATED_TV: BrowseSource = { key: 'top-rated-tv', title: 'Top Rated TV Shows', load: getTopRatedTV };
// Trending has a single page; later pages are empty so Browse stops paging.
export const TRENDING_MOVIES: BrowseSource = { key: 'trending-movies', title: 'Trending Movies', load: page => (page > 1 ? Promise.resolve([]) : getTrending('movie', 'week')) };
export const TRENDING_TV: BrowseSource = { key: 'trending-tv', title: 'Trending TV Shows', load: page => (page > 1 ? Promise.resolve([]) : getTrending('tv', 'week')) };
export const TRENDING_ALL: BrowseSource = { key: 'trending-all', title: 'Trending Now', load: page => (page > 1 ? Promise.resolve([]) : getTrending('all', 'week')) };
