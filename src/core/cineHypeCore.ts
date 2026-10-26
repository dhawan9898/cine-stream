// cineHypeCore.ts - CineHype Core Provider (TMDB API & Media Models)
import { readPersistedAsync, writePersisted } from './persistentCache.ts';

export const CINEHYPE_TMDB_KEY =
  import.meta.env.VITE_TMDB_API_KEY || '90b2cae8d7161e8ba0f3836240d7d352';
export const TMDB_API_BASE =
  import.meta.env.DEV && import.meta.env.VITE_USE_TMDB_PROXY === 'true'
    ? '/api-tmdb'
    : 'https://api.themoviedb.org/3';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export type MediaType = 'movie' | 'tv';

export interface Genre {
  id: number;
  name: string;
}

export interface MediaItem {
  id: number;
  title: string;
  originalTitle?: string;
  mediaType: MediaType;
  poster: string;
  backdrop: string;
  overview: string;
  releaseDate: string; // YYYY-MM-DD
  voteAverage: number;
  voteCount?: number;
  genreIds?: number[];
  genres?: string[];
  runtime?: number; // In minutes
  tagline?: string;
  status?: string;
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
}

export interface SeasonItem {
  id: number;
  seasonNumber: number;
  name: string;
  overview: string;
  poster: string;
  episodeCount: number;
  airDate?: string;
}

export interface EpisodeItem {
  id: number;
  episodeNumber: number;
  seasonNumber: number;
  name: string;
  overview: string;
  still: string;
  runtime?: number;
  airDate?: string;
  voteAverage?: number;
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile: string;
}

export interface VideoTrailer {
  id: string;
  key: string;
  name: string;
  site: string; // 'YouTube'
  type: string; // 'Trailer' | 'Teaser'
}

export interface MediaDetails extends MediaItem {
  seasons?: SeasonItem[];
  cast: CastMember[];
  trailers: VideoTrailer[];
  recommendations: MediaItem[];
  collection?: {
    id: number;
    name: string;
    poster: string;
    backdrop: string;
    parts?: MediaItem[];
  };
}

// Image URL Formatters
export function getPosterUrl(path?: string | null, size: 'w200' | 'w342' | 'w500' | 'original' = 'w500'): string {
  if (!path) return '';
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function getBackdropUrl(path?: string | null, size: 'w780' | 'w1280' | 'original' = 'original'): string {
  if (!path) return '';
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function getStillUrl(path?: string | null, size: 'w300' | 'original' = 'w300'): string {
  if (!path) return '';
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function getProfileUrl(path?: string | null, size: 'w185' | 'h632' | 'original' = 'w185'): string {
  if (!path) return '';
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

// Request Helper. Identical requests made while one is in flight share it, so
// screens that ask for the same list at once cost a single round-trip.
const inFlight = new Map<string, Promise<unknown>>();

function tmdbFetch<T>(endpoint: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const key = endpoint + JSON.stringify(params);
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const request = tmdbFetchOnce<T>(endpoint, params).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

async function tmdbFetchOnce<T>(endpoint: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const query = new URLSearchParams({
    api_key: CINEHYPE_TMDB_KEY,
    language: 'en-US',
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  });

  const url = `${TMDB_API_BASE}${endpoint}?${query.toString()}`;
  // Timeout + retry with backoff on network errors, 429 and 5xx so flaky mobile
  // connections don't surface as hard failures.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok) return (await res.json()) as T;
      lastError = new Error(`TMDB request failed (${res.status}): ${endpoint}`);
      if (res.status !== 429 && res.status < 500) break; // not retryable
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
    await new Promise(r => setTimeout(r, 400 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(`TMDB request failed: ${endpoint}`);
}

// Mapping Raw TMDB results to MediaItem
function mapRawToMedia(item: any, defaultType: MediaType = 'movie'): MediaItem {
  const type: MediaType = item.media_type === 'tv' ? 'tv' : (item.media_type === 'movie' ? 'movie' : defaultType);
  const title = item.title || item.name || item.original_title || item.original_name || 'Untitled';
  return {
    id: item.id,
    title,
    originalTitle: item.original_title || item.original_name,
    mediaType: type,
    poster: getPosterUrl(item.poster_path, 'w500'),
    backdrop: getBackdropUrl(item.backdrop_path, 'original'),
    overview: item.overview || '',
    releaseDate: item.release_date || item.first_air_date || '',
    voteAverage: typeof item.vote_average === 'number' ? Math.round(item.vote_average * 10) / 10 : 0,
    voteCount: item.vote_count,
    genreIds: item.genre_ids || [],
    genres: item.genres?.map((g: any) => g.name) || [],
    runtime: item.runtime || (item.episode_run_time && item.episode_run_time[0]),
    tagline: item.tagline,
    status: item.status,
    numberOfSeasons: item.number_of_seasons,
    numberOfEpisodes: item.number_of_episodes
  };
}

// ================= API Functions =================

// 1. Trending
export async function getTrending(type: 'all' | 'movie' | 'tv' = 'all', time: 'week' | 'day' = 'week'): Promise<MediaItem[]> {
  const cacheKey = `trending_${type}_${time}`;
  const cached = await readPersistedAsync<MediaItem[]>(cacheKey);
  if (cached) return cached;

  const data = await tmdbFetch<{ results: any[] }>(`/trending/${type}/${time}`);
  const items = data.results.filter(i => i.poster_path || i.backdrop_path).map(i => mapRawToMedia(i, type === 'tv' ? 'tv' : 'movie'));
  writePersisted(cacheKey, items, 30 * 60 * 1000);
  return items;
}

// 2. Popular Movies & TV
export async function getPopularMovies(page = 1): Promise<MediaItem[]> {
  const cacheKey = `popular_movies_${page}`;
  const cached = await readPersistedAsync<MediaItem[]>(cacheKey);
  if (cached) return cached;

  const data = await tmdbFetch<{ results: any[] }>('/movie/popular', { page });
  const items = data.results.map(i => mapRawToMedia(i, 'movie'));
  writePersisted(cacheKey, items, 60 * 60 * 1000);
  return items;
}

export async function getPopularTV(page = 1): Promise<MediaItem[]> {
  const cacheKey = `popular_tv_${page}`;
  const cached = await readPersistedAsync<MediaItem[]>(cacheKey);
  if (cached) return cached;

  const data = await tmdbFetch<{ results: any[] }>('/tv/popular', { page });
  const items = data.results.map(i => mapRawToMedia(i, 'tv'));
  writePersisted(cacheKey, items, 60 * 60 * 1000);
  return items;
}

// 3. Top Rated
export async function getTopRatedMovies(page = 1): Promise<MediaItem[]> {
  const cacheKey = `top_rated_movies_${page}`;
  const cached = await readPersistedAsync<MediaItem[]>(cacheKey);
  if (cached) return cached;

  const data = await tmdbFetch<{ results: any[] }>('/movie/top_rated', { page });
  const items = data.results.map(i => mapRawToMedia(i, 'movie'));
  writePersisted(cacheKey, items, 120 * 60 * 1000);
  return items;
}

export async function getTopRatedTV(page = 1): Promise<MediaItem[]> {
  const cacheKey = `top_rated_tv_${page}`;
  const cached = await readPersistedAsync<MediaItem[]>(cacheKey);
  if (cached) return cached;

  const data = await tmdbFetch<{ results: any[] }>('/tv/top_rated', { page });
  const items = data.results.map(i => mapRawToMedia(i, 'tv'));
  writePersisted(cacheKey, items, 120 * 60 * 1000);
  return items;
}

// 4. On The Air TV (new episodes)
export async function getOnTheAirTV(page = 1): Promise<MediaItem[]> {
  const cacheKey = `on_air_tv_${page}`;
  const cached = await readPersistedAsync<MediaItem[]>(cacheKey);
  if (cached) return cached;

  const data = await tmdbFetch<{ results: any[] }>('/tv/on_the_air', { page });
  const items = data.results.map(i => mapRawToMedia(i, 'tv'));
  writePersisted(cacheKey, items, 60 * 60 * 1000);
  return items;
}

// 5. Media Details (Movie & TV)
export async function getMediaDetails(id: number, type: MediaType): Promise<MediaDetails> {
  const cacheKey = `details_${type}_${id}`;
  const cached = await readPersistedAsync<MediaDetails>(cacheKey);
  if (cached) return cached;

  const endpoint = type === 'movie' ? `/movie/${id}` : `/tv/${id}`;
  const data = await tmdbFetch<any>(endpoint, {
    append_to_response: 'videos,credits,recommendations,similar,belongs_to_collection'
  });

  const base = mapRawToMedia(data, type);

  // Cast members
  const cast: CastMember[] = (data.credits?.cast || []).slice(0, 16).map((c: any) => ({
    id: c.id,
    name: c.name,
    character: c.character || 'Unknown',
    profile: getProfileUrl(c.profile_path, 'w185')
  }));

  // Trailers
  const trailers: VideoTrailer[] = (data.videos?.results || [])
    .filter((v: any) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'))
    .map((v: any) => ({
      id: v.id,
      key: v.key,
      name: v.name,
      site: v.site,
      type: v.type
    }));

  // Recommendations
  const recs = (data.recommendations?.results || data.similar?.results || [])
    .filter((r: any) => r.poster_path || r.backdrop_path)
    .slice(0, 15)
    .map((r: any) => mapRawToMedia(r, type));

  // Seasons (for TV)
  let seasons: SeasonItem[] | undefined;
  if (type === 'tv' && data.seasons) {
    seasons = data.seasons
      .filter((s: any) => s.season_number > 0) // exclude specials by default or include
      .map((s: any) => ({
        id: s.id,
        seasonNumber: s.season_number,
        name: s.name,
        overview: s.overview || '',
        poster: getPosterUrl(s.poster_path, 'w342'),
        episodeCount: s.episode_count,
        airDate: s.air_date
      }));
  }

  // Movie Franchise / Collection
  let collection: MediaDetails['collection'];
  if (data.belongs_to_collection) {
    collection = {
      id: data.belongs_to_collection.id,
      name: data.belongs_to_collection.name,
      poster: getPosterUrl(data.belongs_to_collection.poster_path, 'w500'),
      backdrop: getBackdropUrl(data.belongs_to_collection.backdrop_path, 'original')
    };
  }

  const details: MediaDetails = {
    ...base,
    cast,
    trailers,
    recommendations: recs,
    seasons,
    collection
  };

  writePersisted(cacheKey, details, 30 * 60 * 1000);
  return details;
}

export function prefetchMediaDetails(id: number, type: MediaType): void {
  getMediaDetails(id, type).catch(() => {});
}

// 6. TV Season Episodes
export async function getTVSeasonEpisodes(tvId: number, seasonNumber: number): Promise<EpisodeItem[]> {
  const cacheKey = `tv_episodes_${tvId}_s${seasonNumber}`;
  const cached = await readPersistedAsync<EpisodeItem[]>(cacheKey);
  if (cached) return cached;

  const data = await tmdbFetch<any>(`/tv/${tvId}/season/${seasonNumber}`);
  const episodes: EpisodeItem[] = (data.episodes || []).map((e: any) => ({
    id: e.id,
    episodeNumber: e.episode_number,
    seasonNumber: e.season_number,
    name: e.name || `Episode ${e.episode_number}`,
    overview: e.overview || '',
    still: getStillUrl(e.still_path, 'w300'),
    runtime: e.runtime,
    airDate: e.air_date,
    voteAverage: typeof e.vote_average === 'number' ? Math.round(e.vote_average * 10) / 10 : undefined
  }));

  writePersisted(cacheKey, episodes, 60 * 60 * 1000);
  return episodes;
}

// 7. Multi-Search (Movies & TV Series)
export async function searchMedia(query: string, page = 1): Promise<MediaItem[]> {
  if (!query || !query.trim()) return [];
  const clean = query.trim();
  const data = await tmdbFetch<{ results: any[] }>('/search/multi', {
    query: clean,
    page,
    include_adult: false
  });

  return data.results
    .filter(i => (i.media_type === 'movie' || i.media_type === 'tv') && (i.poster_path || i.backdrop_path))
    .map(i => mapRawToMedia(i, i.media_type));
}

// 8. Discover by Genre
export async function discoverByGenre(genreId: number, type: MediaType, page = 1, sortBy = 'popularity.desc'): Promise<MediaItem[]> {
  const cacheKey = `discover_${type}_g${genreId}_p${page}_${sortBy}`;
  const cached = await readPersistedAsync<MediaItem[]>(cacheKey);
  if (cached) return cached;

  const endpoint = type === 'movie' ? '/discover/movie' : '/discover/tv';
  const data = await tmdbFetch<{ results: any[] }>(endpoint, {
    with_genres: genreId,
    page,
    sort_by: sortBy
  });

  const items = data.results
    .filter(i => i.poster_path || i.backdrop_path)
    .map(i => mapRawToMedia(i, type));

  writePersisted(cacheKey, items, 60 * 60 * 1000);
  return items;
}

// 9. Genres lists
export const MOVIE_GENRES: Genre[] = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' },
  { id: 36, name: 'History' },
  { id: 27, name: 'Horror' },
  { id: 10402, name: 'Music' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Sci-Fi' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' },
  { id: 37, name: 'Western' }
];

export const TV_GENRES: Genre[] = [
  { id: 10759, name: 'Action & Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 10762, name: 'Kids' },
  { id: 9648, name: 'Mystery' },
  { id: 10763, name: 'News' },
  { id: 10764, name: 'Reality' },
  { id: 10765, name: 'Sci-Fi & Fantasy' },
  { id: 10766, name: 'Soap' },
  { id: 10767, name: 'Talk' },
  { id: 10768, name: 'War & Politics' },
  { id: 37, name: 'Western' }
];
