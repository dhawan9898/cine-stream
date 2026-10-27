// browseSources.ts - Describes the lists a Browse page can show (a genre, or
// one of Home's rails), so a single screen handles all of them.
import {
  getPopularMovies,
  getPopularTV,
  getTopRatedMovies,
  getTopRatedTV,
  getTrending,
  getOnTheAirTV,
  type MediaItem
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
  // Present for category pages only: lets the Categories switcher highlight
  // it and enables the sort chips.
  category?: { key: string; filter: 'all' | 'movie' | 'tv' };
  load: (page: number, sortBy: SortBy) => Promise<MediaItem[]>;
}

export const POPULAR_MOVIES: BrowseSource = { key: 'popular-movies', title: 'Popular Movies', load: getPopularMovies };
export const POPULAR_TV: BrowseSource = { key: 'popular-tv', title: 'Popular TV Shows', load: getPopularTV };
export const TOP_RATED_MOVIES: BrowseSource = { key: 'top-rated', title: 'Top Rated Movies', load: getTopRatedMovies };
export const ON_THE_AIR: BrowseSource = { key: 'on-the-air', title: 'New Episodes On The Air', load: getOnTheAirTV };
export const TOP_RATED_TV: BrowseSource = { key: 'top-rated-tv', title: 'Top Rated TV Shows', load: getTopRatedTV };
// Trending has a single page; later pages are empty so Browse stops paging.
export const TRENDING_MOVIES: BrowseSource = { key: 'trending-movies', title: 'Trending Movies', load: page => (page > 1 ? Promise.resolve([]) : getTrending('movie', 'week')) };
export const TRENDING_TV: BrowseSource = { key: 'trending-tv', title: 'Trending TV Shows', load: page => (page > 1 ? Promise.resolve([]) : getTrending('tv', 'week')) };
export const TRENDING_ALL: BrowseSource = { key: 'trending-all', title: 'Trending Now', load: page => (page > 1 ? Promise.resolve([]) : getTrending('all', 'week')) };
