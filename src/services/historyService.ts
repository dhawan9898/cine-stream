// historyService.ts - Watch history, continue watching & watchlist persistence
import type { MediaItem, MediaType } from '../providers/cineHypeCore.ts';
import { createChangeNotifier, parseValidatedList } from 'streamkit/core/library.ts';

export interface WatchHistoryItem {
  id: number;
  type: MediaType;
  title: string;
  poster: string;
  backdrop: string;
  // Kept so taste can be learned without refetching details.
  genreIds?: number[];
  language?: string;
  season?: number;
  episode?: number;
  episodeName?: string;
  progressPercent: number; // 0 to 100
  positionMs?: number;
  durationMs?: number;
  lastWatchedAt: number;
}

export interface UserPreferences {
  defaultServer: string;
  autoplayNext: boolean;
  theme: string;
  // Language code ('en', 'hi', ...) or '' for automatic / off.
  audioLanguage: string;
  subtitleLanguage: string;
  // Cap video at 720p on mobile data.
  dataSaver: boolean;
  // Highest video height (px) fetched by Downloads.
  downloadQuality: '1080' | '720' | '480';
  // Prepare the stream while a title page is open, so Play starts almost at once.
  preloadStreams: boolean;
  // 'Auto' or a rendition such as '720p' / '1080p', used when the stream offers it.
  defaultQuality: string;
  // FlixHQ embeds turned into streams by a third-party decrypt service (faster than the in-app
  // sniffer, but that service sees every link asked for). Off unless the viewer turns it on.
  flixhqDecryptApi: boolean;
  // The viewer's own Jellyfin server (Settings > Sources); empty when not set up.
  jellyfinUrl: string;
  jellyfinApiKey: string;
}

const HISTORY_KEY = 'cinestream_watch_history';
const BOOKMARKS_KEY = 'cinestream_bookmarks';
const PREFS_KEY = 'cinestream_preferences';

const DEFAULT_PREFS: UserPreferences = {
  defaultServer: 'vidsrc',
  autoplayNext: true,
  theme: 'dark',
  audioLanguage: '',
  subtitleLanguage: '',
  dataSaver: false,
  downloadQuality: '720',
  preloadStreams: true,
  defaultQuality: 'Auto',
  flixhqDecryptApi: false,
  jellyfinUrl: '',
  jellyfinApiKey: ''
};

// In-Memory state caches to eliminate redundant JSON parsing on renders
let cachedHistory: WatchHistoryItem[] | null = null;
let cachedBookmarks: MediaItem[] | null = null;
let cachedPrefs: UserPreferences | null = null;

// Change notifications. Progress saves use notify(false), which is held back
// while the player is open (see setPlaybackActive) so screens underneath don't
// re-render on every save.
const library = createChangeNotifier();
const notify = library.notify;
export const subscribeLibraryChanges = library.subscribe;
export const setPlaybackActive = library.setPlaybackActive;

// Stored entries with the wrong shape (an interrupted write, an old build) are
// dropped one by one instead of crashing whichever screen renders them.
const isHistoryItem = (v: unknown): boolean => {
  const h = v as Partial<WatchHistoryItem> | null;
  return !!h && typeof h.id === 'number' && (h.type === 'movie' || h.type === 'tv') &&
    typeof h.title === 'string' && typeof h.progressPercent === 'number';
};
const isMediaItem = (v: unknown): boolean => {
  const m = v as Partial<MediaItem> | null;
  return !!m && typeof m.id === 'number' && (m.mediaType === 'movie' || m.mediaType === 'tv') && typeof m.title === 'string';
};

// 1. Watch History
export function getWatchHistory(): WatchHistoryItem[] {
  if (cachedHistory !== null) return cachedHistory;
  try {
    cachedHistory = parseValidatedList<WatchHistoryItem>(localStorage.getItem(HISTORY_KEY), isHistoryItem);
    return cachedHistory;
  } catch {
    cachedHistory = [];
    return cachedHistory;
  }
}

export function getMediaWatchHistory(id: number, type: MediaType): WatchHistoryItem | undefined {
  return getWatchHistory().find(h => h.id === id && h.type === type);
}

export function getResumePositionMs(
  id: number,
  type: MediaType,
  season?: number,
  episode?: number
): number {
  const item = getMediaWatchHistory(id, type);
  if (!item) return 0;
  if (type === 'tv') {
    const targetSeason = season ?? 1;
    const targetEpisode = episode ?? 1;
    if ((item.season ?? 1) !== targetSeason || (item.episode ?? 1) !== targetEpisode) {
      return 0;
    }
  }
  if (item.progressPercent >= 96) return 0;
  return item.positionMs && item.positionMs > 0 ? Math.round(item.positionMs) : 0;
}

export function saveWatchProgress(item: {
  media: MediaItem;
  season?: number;
  episode?: number;
  episodeName?: string;
  progressPercent: number;
  positionMs?: number;
  durationMs?: number;
}): void {
  try {
    const history = getWatchHistory().slice();
    const existingIndex = history.findIndex(h => h.id === item.media.id && h.type === item.media.mediaType);

    const record: WatchHistoryItem = {
      id: item.media.id,
      type: item.media.mediaType,
      title: item.media.title,
      poster: item.media.poster,
      backdrop: item.media.backdrop,
      genreIds: item.media.genreIds?.length ? item.media.genreIds : history[existingIndex]?.genreIds,
      language: item.media.language ?? history[existingIndex]?.language,
      season: item.season,
      episode: item.episode,
      episodeName: item.episodeName,
      progressPercent: Math.min(100, Math.max(0, item.progressPercent)),
      positionMs: item.positionMs !== undefined ? Math.max(0, Math.round(item.positionMs)) : undefined,
      durationMs: item.durationMs !== undefined ? Math.max(0, Math.round(item.durationMs)) : undefined,
      lastWatchedAt: Date.now()
    };

    if (existingIndex !== -1) {
      history.splice(existingIndex, 1);
    }
    history.unshift(record);

    // Keep top 30 history items
    const trimmed = history.slice(0, 30);
    cachedHistory = trimmed;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    if (item.media.mediaType === 'tv' && item.positionMs !== undefined && item.durationMs !== undefined) {
      recordEpisode(item.media.id, item.season ?? 1, item.episode ?? 1, item.positionMs, item.durationMs);
    }
    notify(false);
  } catch {}
}

// Per-episode progress, kept for every episode watched (the history list above
// holds only the latest episode per title), so the episode list can show what
// has been seen and what is half-finished.
const EPISODE_LOG_KEY = 'cinestream_episode_log';
const EPISODE_LOG_MAX = 600;
export interface EpisodeProgress { positionMs: number; durationMs: number }
type EpisodeLog = Record<string, EpisodeProgress & { at: number }>;
let cachedEpisodeLog: EpisodeLog | null = null;
const episodeKey = (id: number, season: number, episode: number) => `${id}|${season}|${episode}`;

function readEpisodeLog(): EpisodeLog {
  if (cachedEpisodeLog) return cachedEpisodeLog;
  try {
    const parsed = JSON.parse(localStorage.getItem(EPISODE_LOG_KEY) || '{}');
    cachedEpisodeLog = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    cachedEpisodeLog = {};
  }
  return cachedEpisodeLog!;
}

function recordEpisode(id: number, season: number, episode: number, positionMs: number, durationMs: number): void {
  if (!(durationMs > 0)) return;
  const log = { ...readEpisodeLog(), [episodeKey(id, season, episode)]: { positionMs, durationMs, at: Date.now() } };
  const keys = Object.keys(log);
  if (keys.length > EPISODE_LOG_MAX) {
    keys.sort((a, b) => log[a].at - log[b].at).slice(0, keys.length - EPISODE_LOG_MAX).forEach(k => delete log[k]);
  }
  cachedEpisodeLog = log;
  localStorage.setItem(EPISODE_LOG_KEY, JSON.stringify(log));
}

/** How far the viewer got in each episode of a title, keyed `season|episode`. */
export function getEpisodeProgress(id: number): Record<string, EpisodeProgress> {
  const out: Record<string, EpisodeProgress> = {};
  const prefix = `${id}|`;
  for (const [k, v] of Object.entries(readEpisodeLog())) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = { positionMs: v.positionMs, durationMs: v.durationMs };
  }
  return out;
}

export function isEpisodeFinished(p: { positionMs?: number; durationMs?: number; progressPercent?: number }): boolean {
  if (p.durationMs && p.durationMs > 0 && p.positionMs !== undefined) {
    return p.durationMs - p.positionMs <= 30_000 || p.positionMs / p.durationMs >= 0.95;
  }
  return (p.progressPercent ?? 0) >= 95;
}

export function episodeWatchState(p: EpisodeProgress | undefined): 'finished' | 'partial' | 'unwatched' {
  if (!p) return 'unwatched';
  if (isEpisodeFinished(p)) return 'finished';
  return p.positionMs >= 15_000 ? 'partial' : 'unwatched';
}

export function removeWatchHistory(id: number, type: MediaType): void {
  try {
    const history = getWatchHistory().filter(h => !(h.id === id && h.type === type));
    cachedHistory = history;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    notify();
  } catch {}
}

export function clearWatchHistory(): void {
  try {
    cachedHistory = [];
    cachedEpisodeLog = null;
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(EPISODE_LOG_KEY);
    notify();
  } catch {}
}

// 2. Bookmarks / Watchlist
export function getBookmarks(): MediaItem[] {
  if (cachedBookmarks !== null) return cachedBookmarks;
  try {
    cachedBookmarks = parseValidatedList<MediaItem>(localStorage.getItem(BOOKMARKS_KEY), isMediaItem);
    return cachedBookmarks;
  } catch {
    cachedBookmarks = [];
    return cachedBookmarks;
  }
}

export function isBookmarked(id: number, type: MediaType): boolean {
  const bookmarks = getBookmarks();
  return bookmarks.some(b => b.id === id && b.mediaType === type);
}

export function toggleBookmark(media: MediaItem): boolean {
  try {
    const bookmarks = getBookmarks().slice();
    const index = bookmarks.findIndex(b => b.id === media.id && b.mediaType === media.mediaType);
    let bookmarked = false;

    if (index !== -1) {
      bookmarks.splice(index, 1);
    } else {
      bookmarks.unshift(media);
      bookmarked = true;
    }

    cachedBookmarks = bookmarks;
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
    notify();
    return bookmarked;
  } catch {
    return false;
  }
}

// 3. User Preferences
export function getUserPreferences(): UserPreferences {
  if (cachedPrefs !== null) return cachedPrefs;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    cachedPrefs = raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
    return cachedPrefs!;
  } catch {
    cachedPrefs = DEFAULT_PREFS;
    return cachedPrefs;
  }
}

export function saveUserPreferences(prefs: Partial<UserPreferences>): void {
  try {
    const current = getUserPreferences();
    const updated = { ...current, ...prefs };
    cachedPrefs = updated;
    localStorage.setItem(PREFS_KEY, JSON.stringify(updated));
    notify();
  } catch {}
}

export function clearBookmarks(): void {
  try {
    cachedBookmarks = [];
    localStorage.removeItem(BOOKMARKS_KEY);
    notify();
  } catch {}
}
