// tasteService.ts - Learns what the viewer likes from watch history, My List
// and how much of each title they actually watched. Everything is local.
import { getMediaDetails, type MediaItem } from '../core/cineHypeCore.ts';
import { getBookmarks, getWatchHistory, type WatchHistoryItem } from './historyService.ts';
import { genreCategoryForId, getCategory, LANGUAGES, type Category } from './categories.ts';

export interface Taste {
  genres: Category[];     // most to least liked
  languages: Category[];  // most to least watched (only meaningful ones)
  prefersTV: boolean;
  hasSignal: boolean;
}

export const EMPTY_TASTE: Taste = { genres: [], languages: [], prefersTV: false, hasSignal: false };

const MAX_HISTORY = 12;
const DAY = 24 * 60 * 60 * 1000;

interface Signal { type: 'movie' | 'tv'; genreIds: number[]; language?: string; weight: number }

// Weight: finishing or mostly watching counts more than bouncing off, and
// recent activity counts more than old. Saving to My List is a strong "yes".
async function signalFor(h: WatchHistoryItem): Promise<Signal | null> {
  let genreIds = h.genreIds;
  let language = h.language;
  if (!genreIds?.length) {
    try {
      const d = await getMediaDetails(h.id, h.type);
      genreIds = d.genreIds;
      language = d.language;
    } catch {
      return null;
    }
  }
  const ageDays = Math.max(0, (Date.now() - h.lastWatchedAt) / DAY);
  const recency = Math.pow(0.5, ageDays / 30);
  const engagement = h.progressPercent < 5 ? 0.3 : 0.6 + Math.min(100, h.progressPercent) / 100;
  return { type: h.type, genreIds: genreIds ?? [], language, weight: recency * engagement };
}

const fromBookmark = (m: MediaItem): Signal => ({
  type: m.mediaType,
  genreIds: m.genreIds ?? [],
  language: m.language,
  weight: 1.2
});

export async function computeTaste(): Promise<Taste> {
  const signals = (await Promise.all(getWatchHistory().slice(0, MAX_HISTORY).map(signalFor)))
    .filter((s): s is Signal => s !== null);
  for (const b of getBookmarks().slice(0, MAX_HISTORY)) signals.push(fromBookmark(b));
  if (signals.length === 0) return EMPTY_TASTE;

  const genreScore = new Map<string, number>();
  const langScore = new Map<string, number>();
  let tv = 0;
  let total = 0;
  for (const s of signals) {
    total += s.weight;
    if (s.type === 'tv') tv += s.weight;
    for (const id of s.genreIds) {
      const cat = genreCategoryForId(id);
      if (cat) genreScore.set(cat.key, (genreScore.get(cat.key) ?? 0) + s.weight);
    }
    if (s.language) langScore.set(s.language, (langScore.get(s.language) ?? 0) + s.weight);
  }

  const genres = [...genreScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key]) => getCategory(key)!)
    .filter(Boolean);
  // English is the default catalogue language, so it says little about taste.
  const languages = [...langScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code]) => LANGUAGES.find(l => l.language === code))
    .filter((l): l is Category => Boolean(l) && l!.language !== 'en')
    .slice(0, 3);

  return { genres, languages, prefersTV: tv / total > 0.6, hasSignal: true };
}
