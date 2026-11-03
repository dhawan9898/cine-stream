// HeroCarousel.tsx - CineStream's featured banner: maps titles to the shared
// carousel and keeps the "My List" state in sync with the library.
import React, { useEffect, useMemo, useState } from 'react';
import { HeroCarousel as SharedHeroCarousel, type HeroSlide } from 'streamkit/ui/HeroCarousel.tsx';
import { MOVIE_GENRES, TV_GENRES, type MediaItem } from '../providers/cineHypeCore.ts';
import { getBookmarks, subscribeLibraryChanges, toggleBookmark } from '../services/historyService.ts';

const MAX_SLIDES = 8;

interface HeroCarouselProps {
  items: MediaItem[];
  onPlay: (item: MediaItem) => void;
  onOpenDetails: (item: MediaItem) => void;
  // True while another screen covers this one - no auto-advance then.
  paused?: boolean;
  rankLabel?: string;
}

const GENRE_NAMES = new Map<number, string>(
  [...MOVIE_GENRES, ...TV_GENRES].filter(g => g.id < 2000).map(g => [g.id, g.name])
);
const genreLine = (m: MediaItem) =>
  (m.genreIds ?? []).map(id => GENRE_NAMES.get(id)).filter(Boolean).slice(0, 3).join(' • ');

const key = (m: MediaItem) => `${m.mediaType}-${m.id}`;

export const HeroCarousel: React.FC<HeroCarouselProps> = ({ items, onPlay, onOpenDetails, paused = false, rankLabel = 'Trending' }) => {
  const titles = useMemo(() => items.slice(0, MAX_SLIDES), [items]);
  const [saved, setSaved] = useState<Set<string>>(() => new Set(getBookmarks().map(key)));

  useEffect(() => subscribeLibraryChanges(() => setSaved(new Set(getBookmarks().map(key)))), []);

  const slides: HeroSlide[] = useMemo(() => titles.map(m => {
    const year = m.releaseDate ? m.releaseDate.slice(0, 4) : '';
    return {
      key: key(m),
      title: m.title,
      image: m.backdrop || m.poster,
      chips: [m.mediaType === 'tv' ? 'Series' : 'Movie', ...(year ? [year] : [])],
      subline: genreLine(m) || undefined,
      description: m.overview || undefined,
      saved: saved.has(key(m))
    };
  }), [titles, saved]);

  const find = (k: string) => titles.find(m => key(m) === k);

  return (
    <SharedHeroCarousel
      slides={slides}
      rankLabel={rankLabel}
      primaryLabel="Play"
      onPrimary={k => { const m = find(k); if (m) onPlay(m); }}
      onSecondary={k => { const m = find(k); if (m) onOpenDetails(m); }}
      onToggleSaved={k => { const m = find(k); if (m) toggleBookmark(m); }}
      paused={paused}
    />
  );
};
