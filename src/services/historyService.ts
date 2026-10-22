// historyService.ts - Watch history, continue watching & watchlist persistence
import type { MediaItem, MediaType } from '../core/cineHypeCore.ts';

export interface WatchHistoryItem {
  id: number;
  type: MediaType;
  title: string;
  poster: string;
  backdrop: string;
  season?: number;
  episode?: number;
  episodeName?: string;
  progressPercent: number; // 0 to 100
  lastWatchedAt: number;
}

export interface UserPreferences {
  defaultServer: string;
  autoplayNext: boolean;
  theme: string;
}

const HISTORY_KEY = 'cinestream_watch_history';
const BOOKMARKS_KEY = 'cinestream_bookmarks';
const PREFS_KEY = 'cinestream_preferences';

const DEFAULT_PREFS: UserPreferences = {
  defaultServer: 'vidfast',
  autoplayNext: true,
  theme: 'dark'
};

// Listeners
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(cb => {
    try { cb(); } catch {}
  });
}

export function subscribeLibraryChanges(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// 1. Watch History
export function getWatchHistory(): WatchHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveWatchProgress(item: {
  media: MediaItem;
  season?: number;
  episode?: number;
  episodeName?: string;
  progressPercent: number;
}): void {
  try {
    const history = getWatchHistory();
    const existingIndex = history.findIndex(h => h.id === item.media.id && h.type === item.media.mediaType);

    const record: WatchHistoryItem = {
      id: item.media.id,
      type: item.media.mediaType,
      title: item.media.title,
      poster: item.media.poster,
      backdrop: item.media.backdrop,
      season: item.season,
      episode: item.episode,
      episodeName: item.episodeName,
      progressPercent: Math.min(100, Math.max(0, item.progressPercent)),
      lastWatchedAt: Date.now()
    };

    if (existingIndex !== -1) {
      history.splice(existingIndex, 1);
    }
    history.unshift(record);

    // Keep top 30 history items
    const trimmed = history.slice(0, 30);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    notify();
  } catch {}
}

export function removeWatchHistory(id: number, type: MediaType): void {
  try {
    const history = getWatchHistory().filter(h => !(h.id === id && h.type === type));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    notify();
  } catch {}
}

export function clearWatchHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
    notify();
  } catch {}
}

// 2. Bookmarks / Watchlist
export function getBookmarks(): MediaItem[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function isBookmarked(id: number, type: MediaType): boolean {
  const bookmarks = getBookmarks();
  return bookmarks.some(b => b.id === id && b.mediaType === type);
}

export function toggleBookmark(media: MediaItem): boolean {
  try {
    const bookmarks = getBookmarks();
    const index = bookmarks.findIndex(b => b.id === media.id && b.mediaType === media.mediaType);
    let bookmarked = false;

    if (index !== -1) {
      bookmarks.splice(index, 1);
    } else {
      bookmarks.unshift(media);
      bookmarked = true;
    }

    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
    notify();
    return bookmarked;
  } catch {
    return false;
  }
}

// 3. User Preferences
export function getUserPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveUserPreferences(prefs: Partial<UserPreferences>): void {
  try {
    const current = getUserPreferences();
    const updated = { ...current, ...prefs };
    localStorage.setItem(PREFS_KEY, JSON.stringify(updated));
    notify();
  } catch {}
}
