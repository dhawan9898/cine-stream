// HomeScreen.tsx - Netflix-style home. Rows are built from one unified
// category pool (movies + TV, every language and genre) and ordered by what
// the viewer watches; rows below the fold load when scrolled near.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, ChevronRight, ChevronDown, Search as SearchIcon, X, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { clearPersistedCache } from '../services/persistentCache.ts';
import { Priority, prefetchStream, warmStreams } from '../providers/streamResolver.ts';
import { getTrending, getRecommendations, type MediaItem } from '../providers/cineHypeCore.ts';
import { getWatchHistory, getBookmarks, removeWatchHistory, subscribeLibraryChanges, type WatchHistoryItem } from '../services/historyService.ts';
import {
  ON_THE_AIR,
  POPULAR_MOVIES,
  POPULAR_TV,
  TOP_RATED_MOVIES,
  TOP_RATED_TV,
  TRENDING_MOVIES,
  TRENDING_TV,
  TRENDING_ALL,
  type BrowseSource
} from '../services/browseSources.ts';
import {
  GENRES,
  MOODS,
  categorySource,
  categorySupports,
  getCategory,
  type Category,
  type TypeFilter
} from '../services/categories.ts';
import { computeTaste, EMPTY_TASTE, type Taste } from '../services/tasteService.ts';
import { HeroCarousel } from '../components/HeroCarousel.tsx';
import { PosterCard } from '../components/PosterCard.tsx';
import { QuickPreview } from '../components/QuickPreview.tsx';
import { FadeImage } from 'streamkit/ui/FadeImage.tsx';
import { ErrorState } from 'streamkit/ui/ErrorState.tsx';
import { GenrePicker } from '../components/GenrePicker.tsx';
import { hapticLight, hapticMedium, hapticSelection } from '../services/hapticsService.ts';

interface HomeScreenProps {
  onSelectMedia: (item: MediaItem) => void;
  onPlayMedia: (item: MediaItem, season?: number, episode?: number) => void;
  onOpenSearch: () => void;
  onOpenSource: (source: BrowseSource) => void;
  // True while another screen covers Home (no auto-advance / polling).
  paused: boolean;
}

// Top selection strictly has TV Shows and Movies (like Netflix)
const MODES: { id: 'tv' | 'movie'; label: string }[] = [
  { id: 'tv', label: 'TV Shows' },
  { id: 'movie', label: 'Movies' }
];

const MAX_RAILS = 16;
const cat = (key: string) => getCategory(key)!;

// Curated genres and moods matching Netflix-style discovery
const DEFAULT_GENRES = ['action', 'comedy', 'romance', 'scifi', 'thriller', 'horror', 'crime', 'animation', 'drama', 'documentary'];
const DEFAULT_MOODS = ['feel-good', 'edge-of-seat', 'mind-bending', 'family-night'];

// Ordered list of rows for a tab. Taste-based rows come first so the top of
// the feed feels personal; the rest fills in a varied, de-duplicated catalogue.
function buildRails(filter: TypeFilter, taste: Taste): BrowseSource[] {
  const rails: BrowseSource[] = [];
  const add = (src: BrowseSource | null) => { if (src && !rails.some(r => r.key === src.key)) rails.push(src); };
  const addCat = (c: Category, title?: string) => {
    if (categorySupports(c, filter)) add(categorySource(c, filter, { title }));
  };

  if (taste.hasSignal) {
    const [topGenre, secondGenre, thirdGenre] = taste.genres;
    if (topGenre) addCat(topGenre, `Because You Like ${topGenre.name}`);
    if (secondGenre) addCat(secondGenre, `More ${secondGenre.name} for You`);
    if (thirdGenre) addCat(thirdGenre, `Top ${thirdGenre.name} Titles`);
  }

  if (filter === 'tv') {
    add(POPULAR_TV); add(ON_THE_AIR); add(TOP_RATED_TV);
  } else if (filter === 'movie') {
    add(POPULAR_MOVIES); add(TOP_RATED_MOVIES);
  } else {
    add(POPULAR_MOVIES); add(POPULAR_TV); add(TOP_RATED_MOVIES); add(ON_THE_AIR);
  }

  // Interleave the genres and moods
  const moods = DEFAULT_MOODS.map(cat);
  const genres = DEFAULT_GENRES.map(cat);
  for (let i = 0; i < Math.max(moods.length, genres.length); i++) {
    for (const c of [genres[i], moods[i]]) if (c) addCat(c);
  }
  return rails.slice(0, MAX_RAILS);
}

// Quick genre and category chips for the active mode (Netflix-style, no regional languages)
function buildChips(filter: TypeFilter, taste: Taste): BrowseSource[] {
  const seen = new Set<string>();
  const curatedGenres = GENRES.filter(g => categorySupports(g, filter));
  const pool = [
    ...taste.genres,
    ...curatedGenres,
    ...MOODS
  ];
  return pool
    .filter(c => categorySupports(c, filter) && !seen.has(c.key) && seen.add(c.key))
    .slice(0, 14)
    .map(c => categorySource(c, filter, { title: c.name }));
}

const RailHeader: React.FC<{ title: string; onSeeAll?: () => void }> = ({ title, onSeeAll }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', marginBottom: '10px' }}>
    <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
    {onSeeAll && (
      <button
        onClick={() => { hapticLight(); onSeeAll(); }}
        className="interactive"
        aria-label={`See all ${title}`}
        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        <span>See all</span>
        <ChevronRight size={16} />
      </button>
    )}
  </div>
);

// One rail that fetches its first page only once it nears the viewport.
const LazyRail: React.FC<{
  source: BrowseSource;
  onSelectMedia: (m: MediaItem) => void;
  onPreview: (m: MediaItem) => void;
  onSeeAll: () => void;
}> = ({ source, onSelectMedia, onPreview, onSeeAll }) => {
  const holder = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el || near) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: '500px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    source.load(1, 'popularity.desc')
      .then(list => { if (!cancelled) { setItems(list); warmStreams(list, 3); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [near, source]);

  // A row that loaded empty is dropped rather than shown as a blank header.
  if (failed || (items !== null && items.length === 0)) return null;
  return (
    <div ref={holder} style={{ padding: '18px 0 4px 0', minHeight: '220px' }}>
      <RailHeader title={source.title} onSeeAll={onSeeAll} />
      <div className="rail" style={{ gap: '10px', padding: '0 20px 6px 20px' }}>
        {items === null
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ flex: '0 0 112px', height: '162px', borderRadius: 'var(--radius-md)' }} />
            ))
          : items.map(m => (
              <PosterCard key={`${m.mediaType}-${m.id}`} media={m} width={112} onSelect={onSelectMedia} onPreview={onPreview} />
            ))}
      </div>
    </div>
  );
};

// Rail whose items are already known (My List, Top 10, recommendations).
const ItemRail: React.FC<{
  title: string;
  items: MediaItem[];
  onSelectMedia: (m: MediaItem) => void;
  onPreview: (m: MediaItem) => void;
  onSeeAll?: () => void;
  ranked?: boolean;
}> = ({ title, items, onSelectMedia, onPreview, onSeeAll, ranked }) => (
  <div style={{ padding: '18px 0 4px 0' }}>
    <RailHeader title={title} onSeeAll={onSeeAll} />
    <div className="rail" style={{ gap: ranked ? '4px' : '10px', padding: '0 20px 6px 20px' }}>
      {items.map((m, i) => ranked ? (
        <div key={`${m.mediaType}-${m.id}`} className="top10-item">
          <span className="top10-num">{i + 1}</span>
          <PosterCard media={m} width={104} onSelect={onSelectMedia} onPreview={onPreview} />
        </div>
      ) : (
        <PosterCard key={`${m.mediaType}-${m.id}`} media={m} width={112} onSelect={onSelectMedia} onPreview={onPreview} />
      ))}
    </div>
  </div>
);

// "Because you watched X": TMDB recommendations for the latest title in history.
const BecauseYouWatched: React.FC<{ seed: WatchHistoryItem; filter: TypeFilter; onSelectMedia: (m: MediaItem) => void; onPreview: (m: MediaItem) => void }> = ({ seed, filter, onSelectMedia, onPreview }) => {
  const [items, setItems] = useState<MediaItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    setItems([]);
    getRecommendations(seed.id, seed.type)
      .then(list => { if (!cancelled) { setItems(list); warmStreams(list, 3); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [seed.id, seed.type]);
  const shown = filter === 'all' ? items : items.filter(m => m.mediaType === filter);
  if (shown.length < 4) return null;
  return <ItemRail title={`Because You Watched ${seed.title}`} items={shown} onSelectMedia={onSelectMedia} onPreview={onPreview} />;
};

// "Top picks for you": recommendations blended from the last few titles
// watched, minus anything already in history, best-rated first.
const PicksForYou: React.FC<{ seeds: WatchHistoryItem[]; watched: Set<string>; filter: TypeFilter; onSelectMedia: (m: MediaItem) => void; onPreview: (m: MediaItem) => void }> = ({ seeds, watched, filter, onSelectMedia, onPreview }) => {
  const [items, setItems] = useState<MediaItem[]>([]);
  const seedKey = seeds.map(h => `${h.type}-${h.id}`).join(',');
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(seeds.map(h => getRecommendations(h.id, h.type))).then(results => {
      if (cancelled) return;
      const seen = new Set<string>();
      const merged: MediaItem[] = [];
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        for (const m of r.value) {
          const k = `${m.mediaType}-${m.id}`;
          if (seen.has(k) || watched.has(k)) continue;
          seen.add(k);
          merged.push(m);
        }
      }
      merged.sort((a, b) => b.voteAverage - a.voteAverage);
      setItems(merged.slice(0, 20));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);
  const shown = filter === 'all' ? items : items.filter(m => m.mediaType === filter);
  if (shown.length < 4) return null;
  return <ItemRail title="Top Picks for You" items={shown} onSelectMedia={onSelectMedia} onPreview={onPreview} />;
};

export const HomeScreen: React.FC<HomeScreenProps> = ({ onSelectMedia, onPlayMedia, onOpenSearch, onOpenSource, paused }) => {
  const [trending, setTrending] = useState<MediaItem[]>([]);
  const [trendingError, setTrendingError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<WatchHistoryItem[]>(() => getWatchHistory());
  const [myList, setMyList] = useState<MediaItem[]>(() => getBookmarks());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<TypeFilter>('all');
  const [mode, setMode] = useState<TypeFilter>('all');
  const [taste, setTaste] = useState<Taste>(EMPTY_TASTE);
  const [preview, setPreview] = useState<MediaItem | null>(null);

  useEffect(() => subscribeLibraryChanges(() => { setHistory(getWatchHistory()); setMyList(getBookmarks()); }), []);

  // Re-learn taste when the set of watched / saved titles changes (not on
  // every progress tick, which only moves percentages).
  const tasteKey = `${history.map(h => `${h.type}-${h.id}`).join(',')}|${myList.length}`;
  useEffect(() => {
    let cancelled = false;
    computeTaste().then(t => { if (!cancelled) setTaste(t); }).catch(() => {});
    return () => { cancelled = true; };
  }, [tasteKey]);

  // Get what you were watching ready first, so Continue Watching plays at once.
  useEffect(() => {
    warmStreams(history.slice(0, 3).map(h => ({
      id: h.id,
      mediaType: h.type,
      title: h.title,
      language: h.language,
      // A finished episode means the next one is what you'll press.
      season: h.season,
      episode: h.type === 'tv' && h.episode ? (h.progressPercent >= 92 ? h.episode + 1 : h.episode) : undefined
    })), 3, Priority.FOCUS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasteKey]);

  useEffect(() => {
    let cancelled = false;
    setTrending([]);
    getTrending(mode, 'week')
      .then(items => {
        if (!cancelled) {
          setTrending(items);
          setTrendingError(false);
          items.slice(0, 3).forEach(m => prefetchStream({ id: m.id, type: m.mediaType, title: m.title }, { priority: Priority.FOCUS }));
          warmStreams(items, 6);
        }
      })
      .catch(() => { if (!cancelled) setTrendingError(true); });
    return () => { cancelled = true; };
  }, [attempt, mode]);

  const retry = useCallback(() => { setTrendingError(false); setAttempt(n => n + 1); }, []);

  // Pull down from the top to refresh: drops cached lists and reloads every row.
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const pullStart = useRef<number | null>(null);
  const PULL_TRIGGER = 64;

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    pullStart.current = e.currentTarget.scrollTop <= 0 && !refreshing ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pullStart.current === null) return;
    const dy = e.touches[0].clientY - pullStart.current;
    if (dy <= 0 || e.currentTarget.scrollTop > 0) { if (pull) setPull(0); return; }
    setPull(Math.min(dy * 0.5, 96));
  };
  const onTouchEnd = () => {
    const shouldRefresh = pullStart.current !== null && pull >= PULL_TRIGGER;
    pullStart.current = null;
    setPull(0);
    if (!shouldRefresh) return;
    navigator.vibrate?.(10);
    setRefreshing(true);
    clearPersistedCache();
    setTrendingError(false);
    setAttempt(n => n + 1);
    setRefreshKey(k => k + 1);
    window.setTimeout(() => setRefreshing(false), 1100);
  };

  const rails = useMemo(() => buildRails(mode, taste), [mode, taste]);
  const chips = useMemo(() => buildChips(mode, taste), [mode, taste]);
  const watched = useMemo(() => new Set(history.map(h => `${h.type}-${h.id}`)), [history]);
  const seed = history.find(h => h.progressPercent > 5);
  const top10Source = mode === 'tv' ? TRENDING_TV : mode === 'movie' ? TRENDING_MOVIES : TRENDING_ALL;
  const suggested = useMemo(() => taste.genres, [taste]);

  const openPicker = () => { setPickerFilter(mode === 'all' ? 'tv' : mode); setPickerOpen(true); };

  return (
    <div
      className="screen-scroll"
      style={{ paddingBottom: '110px', position: 'relative' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        className={`ptr-indicator${refreshing ? ' spinning' : ''}`}
        aria-hidden
        style={{
          transform: `translate3d(-50%, ${refreshing ? 56 : pull - 40}px, 0) rotate(${refreshing ? 0 : pull * 4}deg)`,
          opacity: refreshing ? 1 : Math.min(1, pull / PULL_TRIGGER)
        }}
      >
        <RefreshCw size={18} />
      </div>
      {/* Top bar: wordmark + Categories + search, floating over the hero.
          Gradient only, no blur - a blurred sticky bar re-renders the whole
          feed under it on every scroll frame. */}
      {/* Optimized Top bar: wordmark + Fixed Segmented Type Switcher + Categories + Search */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'linear-gradient(180deg, rgba(9,9,15,0.94) 0%, rgba(9,9,15,0.72) 70%, transparent 100%)',
          padding: 'calc(var(--safe-top) + 12px) 20px 8px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          {/* Brand mark */}
          <div style={{ display: 'flex', alignItems: 'baseline', flexShrink: 0 }}>
            <span style={{ fontSize: '24px', fontWeight: 900, letterSpacing: '-0.8px', color: 'var(--accent-primary)', textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>CINE</span>
            <span style={{ fontSize: '24px', fontWeight: 900, letterSpacing: '-0.8px', color: '#fff', textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>STREAM</span>
          </div>

          {/* Top Selection: TV Shows | Movies (Netflix-style) */}
          <div
            className="seg-track glass-panel"
            style={{
              padding: '3px',
              borderRadius: 'var(--radius-full)',
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.08)'
            }}
          >
            {MODES.map(m => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    hapticSelection();
                    setMode(curr => curr === m.id ? 'all' : m.id);
                  }}
                  className={`interactive ${active ? 'active' : ''}`}
                  aria-pressed={active}
                  style={{
                    padding: '5px 15px',
                    borderRadius: 'var(--radius-full)',
                    border: 'none',
                    backgroundColor: active ? 'var(--accent-primary)' : 'transparent',
                    color: active ? '#ffffff' : 'rgba(255, 255, 255, 0.75)',
                    fontSize: '12.5px',
                    fontWeight: active ? 800 : 600,
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Action buttons (Categories and Search) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <button
              onClick={() => { hapticLight(); openPicker(); }}
              className="interactive glass-pill-dark"
              aria-label="Browse Categories"
              style={{ padding: '6px 12px', borderRadius: 'var(--radius-full)', display: 'flex', alignItems: 'center', gap: '5px', color: '#fff', fontSize: '12px', fontWeight: 600 }}
            >
              <SlidersHorizontal size={14} />
              <span>Categories</span>
              <ChevronDown size={14} />
            </button>
            <button
              onClick={() => { hapticLight(); onOpenSearch(); }}
              className="interactive glass-pill-dark"
              aria-label="Search"
              style={{ width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
            >
              <SearchIcon size={17} />
            </button>
          </div>
        </div>

        {/* Quick Genre & Category Chips Strip */}
        <div
          className="rail"
          style={{
            gap: '6px',
            paddingBottom: '2px',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {chips.map(src => (
            <button
              key={src.key}
              onClick={() => { hapticLight(); onOpenSource(src); }}
              className="interactive glass-pill-dark"
              style={{
                padding: '5px 13px',
                borderRadius: 'var(--radius-full)',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontWeight: 600,
                whiteSpace: 'nowrap'
              }}
            >
              {src.title}
            </button>
          ))}
        </div>
      </div>

      {trendingError ? (
        <div style={{ paddingTop: 'calc(var(--safe-top) + 40px)' }}>
          <ErrorState message="Couldn't load movies and shows. Check your connection and try again." onRetry={retry} />
        </div>
      ) : (
        <HeroCarousel items={trending} onPlay={item => onPlayMedia(item)} onOpenDetails={onSelectMedia} paused={paused} rankLabel={mode === 'tv' ? 'TV Today' : mode === 'movie' ? 'Movies Today' : 'Trending'} />
      )}

      {history.length > 0 && (
        <div style={{ padding: '24px 20px 8px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>Continue Watching</h2>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{history.length} {history.length === 1 ? 'title' : 'titles'}</span>
          </div>

          <div className="rail" style={{ gap: '14px', paddingBottom: '10px' }}>
            {history.map(item => {
              const resume = () => onPlayMedia({
                id: item.id,
                title: item.title,
                mediaType: item.type,
                poster: item.poster,
                backdrop: item.backdrop,
                overview: '',
                releaseDate: '',
                voteAverage: 0
              }, item.season, item.episode);
              return (
              <div
                key={`${item.type}-${item.id}`}
                onClick={() => { hapticMedium(); resume(); }}
                onKeyDown={e => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); resume(); }
                }}
                role="button"
                tabIndex={0}
                aria-label={`Resume ${item.title}`}
                className="interactive glass-panel"
                style={{ flex: '0 0 200px', borderRadius: 'var(--radius-md)', overflow: 'hidden', position: 'relative' }}
              >
                <div style={{ position: 'relative', height: '110px' }}>
                  <button
                    onClick={e => { e.stopPropagation(); hapticLight(); removeWatchHistory(item.id, item.type); }}
                    className="interactive"
                    aria-label={`Remove ${item.title} from Continue Watching`}
                    style={{ position: 'absolute', top: '6px', right: '6px', zIndex: 2, width: '26px', height: '26px', borderRadius: '50%', border: 'none', backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <X size={14} />
                  </button>
                  <FadeImage
                    src={item.backdrop || item.poster}
                    alt={item.title}
                    loading="lazy"
                    onLoad={() => {
                      prefetchStream({
                        id: item.id,
                        type: item.type,
                        title: item.title,
                        language: item.language,
                        season: item.season,
                        episode: item.type === 'tv' && item.episode ? (item.progressPercent >= 92 ? item.episode + 1 : item.episode) : undefined
                      }, { priority: Priority.FOCUS });
                    }}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.85) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Play size={16} fill="#fff" color="#fff" style={{ marginLeft: '2px' }} />
                    </div>
                  </div>
                </div>
                <div style={{ width: '100%', height: '3px', backgroundColor: 'rgba(255,255,255,0.2)' }}>
                  <div style={{ width: `${Math.min(100, item.progressPercent)}%`, height: '100%', background: 'var(--accent-primary)' }} />
                </div>
                <div style={{ padding: '10px' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</h4>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {item.type === 'tv' && item.season ? `S${item.season} E${item.episode} · ` : ''}{Math.round(item.progressPercent)}% watched
                  </span>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {myList.length > 0 && (
        <ItemRail
          title="My List"
          items={mode === 'all' ? myList : myList.filter(m => m.mediaType === mode)}
          onSelectMedia={onSelectMedia}
          onPreview={setPreview}
        />
      )}

      {trending.length >= 5 && (
        <ItemRail
          title={mode === 'tv' ? 'Top 10 TV Shows This Week' : mode === 'movie' ? 'Top 10 Movies This Week' : 'Top 10 Today'}
          items={trending.slice(0, 10)}
          onSelectMedia={onSelectMedia}
          onPreview={setPreview}
          onSeeAll={() => onOpenSource(top10Source)}
          ranked
        />
      )}

      {seed && <BecauseYouWatched key={`byw-${refreshKey}`} seed={seed} filter={mode} onSelectMedia={onSelectMedia} onPreview={setPreview} />}
      {history.length > 1 && (
        <PicksForYou seeds={history.slice(1, 4)} watched={watched} filter={mode} onSelectMedia={onSelectMedia} onPreview={setPreview} />
      )}

      {rails.map(source => (
        <LazyRail
          key={`${source.key}-${refreshKey}`}
          source={source}
          onSelectMedia={onSelectMedia}
          onPreview={setPreview}
          onSeeAll={() => onOpenSource(source)}
        />
      ))}

      <GenrePicker
        open={pickerOpen}
        filter={pickerFilter}
        onFilterChange={setPickerFilter}
        suggested={suggested}
        onClose={() => setPickerOpen(false)}
        onSelect={(category, filter) => { setPickerOpen(false); onOpenSource(categorySource(category, filter)); }}
      />

      <QuickPreview
        media={preview}
        onClose={() => setPreview(null)}
        onPlay={m => onPlayMedia(m)}
        onOpenDetails={onSelectMedia}
      />
    </div>
  );
};
