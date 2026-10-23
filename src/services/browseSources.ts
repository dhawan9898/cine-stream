// browseSources.ts - Describes the lists a Browse page can show (a genre, or
// one of Home's rails), so a single screen handles all of them.
import {
  discoverByGenre,
  getPopularMovies,
  getPopularTV,
  getTopRatedMovies,
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

export const genreSource = (genre: Genre, type: MediaType): BrowseSource => ({
  key: `genre-${type}-${genre.id}`,
  title: `${genre.name} ${type === 'movie' ? 'Movies' : 'TV'}`,
  genre: { id: genre.id, type },
  load: (page, sortBy) => discoverByGenre(genre.id, type, page, sortBy)
});

export const POPULAR_MOVIES: BrowseSource = { key: 'popular-movies', title: 'Popular Movies', load: getPopularMovies };
export const POPULAR_TV: BrowseSource = { key: 'popular-tv', title: 'Popular TV Shows', load: getPopularTV };
export const TOP_RATED_MOVIES: BrowseSource = { key: 'top-rated', title: 'Top Rated Movies', load: getTopRatedMovies };
export const ON_THE_AIR: BrowseSource = { key: 'on-the-air', title: 'New Episodes On The Air', load: getOnTheAirTV };
