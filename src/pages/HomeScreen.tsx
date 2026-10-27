// HomeScreen.tsx - Netflix-style home. Rows are built from one unified
// category pool (movies + TV, every language and genre) and ordered by what
// the viewer watches; rows below the fold load when scrolled near.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, ChevronRight, ChevronDown, Search as SearchIcon, X } from 'lucide-react';
import { getTrending, getRecommendations, type MediaItem } from '../core/cineHypeCore.ts';
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
import { FadeImage } from '../components/FadeImage.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { GenrePicker } from '../components/GenrePicker.tsx';

interface HomeScreenProps {
  onSelectMedia: (item: MediaItem) => void;
  onPlayMedia: (item: MediaItem, season?: number, episode?: number) => void;
  onOpenSearch: () => void;
  onOpenSource: (source: BrowseSource) => void;
  // True while another screen covers Home (no auto-advance / polling).
  paused: boolean;
}

const MODES: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'TV Shows' }
];

const MAX_RAILS = 16;
const cat = (key: string) => getCategory(key)!;

// Language / genre rows people expect on first launch, before any history.
const DEFAULT_LANGUAGES = ['lang-te', 'lang-hi', 'lang-ta', 'lang-ml'];
const DEFAULT_GENRES = ['action', 'comedy', 'romance', 'scifi', 'thriller', 'horror', 'crime', 'animation'];
const DEFAULT_MOODS = ['feel-good', 'edge-of-seat', 'mind-bending', 'family-night'];

// Ordered list of rows for a tab. Taste-based rows come first so the top of
// the feed feels personal; the rest fills in a varied, de-duplicated catalogue.
function buildRails(filter: TypeFilter, taste: Taste): BrowseSource[] {
  const rails: BrowseSource[] = [];
  const add = (src: BrowseSource | null) => { if (src && !rails.some(r => r.key === src.key)) rails.push(src); };
  const addCat = (c: Category, title?: string, language?: Category) => {
    if (categorySupports(c, filter)) add(categorySource(c, filter, { title, language }));
  };

  if (taste.hasSignal) {
    const [topGenre, secondGenre, thirdGenre] = taste.genres;
    const [topLang, secondLang] = taste.languages;
    if (topGenre && topLang) addCat(topGenre, `${topLang.name} ${topGenre.name} for You`, topLang);
    if (topGenre) addCat(topGenre, `Because You Like ${topGenre.name}`);
    if (topLang) addCat(topLang, `More in ${topLang.name}`);
    if (secondGenre) addCat(secondGenre, `More ${secondGenre.name} for You`);
    if (secondLang) addCat(secondLang, `More in ${secondLang.name}`);
    if (thirdGenre) addCat(thirdGenre, `Because You Like ${thirdGenre.name}`);
  }

  if (filter === 'tv') {
    add(POPULAR_TV); add(ON_THE_AIR); add(TOP_RATED_TV);
  } else if (filter === 'movie') {
    add(POPULAR_MOVIES); add(TOP_RATED_MOVIES);
  } else {
    add(POPULAR_MOVIES); add(POPULAR_TV); add(TOP_RATED_MOVIES); add(ON_THE_AIR);
  }

  // Interleave the three pools so the feed alternates language / mood / genre.
  const langs = DEFAULT_LANGUAGES.map(cat);
  const moods = DEFAULT_MOODS.map(cat);
  const genres = DEFAULT_GENRES.map(cat);
  for (let i = 0; i < Math.max(langs.length, moods.length, genres.length); i++) {
    for (const c of [langs[i], moods[i], genres[i]]) if (c) addCat(c);
  }
  return rails.slice(0, MAX_RAILS);
}

// Chips next to the tabs: what the viewer likes first, then the popular picks.
function buildChips(filter: TypeFilter, taste: Taste): BrowseSource[] {
  const seen = new Set<string>();
  const pool = [
    ...taste.languages,
    ...taste.genres,
    ...DEFAULT_LANGUAGES.map(cat),
    ...DEFAULT_GENRES.map(cat),
    ...MOODS.slice(0, 2)
  ];
  return pool
    .filter(c => categorySupports(c, filter) && !seen.has(c.key) && seen.add(c.key))
    .slice(0, 12)
    .map(c => categorySource(c, filter, { title: c.name }));
}

const RailHeader: React.FC<{ title: string; onSeeAll?: () => void }> = ({ title, onSeeAll }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', marginBottom: '10px' }}>
    <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
    {onSeeAll && (
      <button
        onClick={onSeeAll}
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
      .then(list => { if (!cancelled) setItems(list); })
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
              <div key={i} className="skeleton" style={{ flex: '0 0 112px', height: '162px', borderRadius: '6px' }} />
            ))
          : items.map(m => (
              <PosterCard key={`${m.mediaType}-${m.id}`} media={m} width={112} onClick={() => onSelectMedia(m)} onPreview={onPreview} />
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
          <PosterCard media={m} width={104} onClick={() => onSelectMedia(m)} onPreview={onPreview} />
        </div>
      ) : (
        <PosterCard key={`${m.mediaType}-${m.id}`} media={m} width={112} onClick={() => onSelectMedia(m)} onPreview={onPreview} />
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
      .then(list => { if (!cancelled) setItems(list); })
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

  useEffect(() => {
    let cancelled = false;
    setTrending([]);
    getTrending(mode, 'week')
      .then(items => { if (!cancelled) { setTrending(items); setTrendingError(false); } })
      .catch(() => { if (!cancelled) setTrendingError(true); });
    return () => { cancelled = true; };
  }, [attempt, mode]);

  const retry = useCallback(() => { setTrendingError(false); setAttempt(n => n + 1); }, []);

  const rails = useMemo(() => buildRails(mode, taste), [mode, taste]);
  const chips = useMemo(() => buildChips(mode, taste), [mode, taste]);
  const watched = useMemo(() => new Set(history.map(h => `${h.type}-${h.id}`)), [history]);
  const seed = history.find(h => h.progressPercent > 5);
  const top10Source = mode === 'tv' ? TRENDING_TV : mode === 'movie' ? TRENDING_MOVIES : TRENDING_ALL;
  const suggested = useMemo(() => [...taste.languages, ...taste.genres], [taste]);

  const openPicker = () => { setPickerFilter(mode); setPickerOpen(true); };

  return (
    <div className="screen-scroll" style={{ paddingBottom: '110px', position: 'relative' }}>
      {/* Top bar: wordmark + Categories + search, floating over the hero.
          Gradient only, no blur - a blurred sticky bar re-renders the whole
          feed under it on every scroll frame. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'linear-gradient(180deg, rgba(11,11,13,0.85) 0%, rgba(11,11,13,0.5) 65%, transparent 100%)',
          padding: 'calc(var(--safe-top) + 12px) 20px 12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span style={{ fontSize: '24px', fontWeight: 900, letterSpacing: '-0.8px', color: 'var(--accent-primary)', textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>CINE</span>
          <span style={{ fontSize: '24px', fontWeight: 900, letterSpacing: '-0.8px', color: '#fff', textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>STREAM</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={openPicker}
            className="interactive glass-pill-dark"
            style={{ padding: '7px 12px', borderRadius: 'var(--radius-full)', display: 'flex', alignItems: 'center', gap: '4px', color: '#fff', fontSize: '13px', fontWeight: 600 }}
          >
            <span>Categories</span>
            <ChevronDown size={16} />
          </button>
          <button
            onClick={onOpenSearch}
            className="interactive glass-pill-dark"
            aria-label="Search"
            style={{ width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
          >
            <SearchIcon size={18} />
          </button>
        </div>
      </div>

      {/* Tabs + quick category chips (Netflix-style filter row). */}
      <div className="rail" style={{ gap: '8px', padding: '0 20px 10px 20px', position: 'relative', zIndex: 2 }}>
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`interactive glass-pill-dark chip ${mode === m.id ? 'active' : ''}`}
            aria-pressed={mode === m.id}
            style={{ padding: '7px 16px', borderRadius: 'var(--radius-full)', color: '#fff', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            {m.label}
          </button>
        ))}
        <span aria-hidden style={{ width: '1px', background: 'rgba(255,255,255,0.18)', margin: '4px 2px', flexShrink: 0 }} />
        {chips.map(src => (
          <button
            key={src.key}
            onClick={() => onOpenSource(src)}
            className="interactive glass-pill-dark"
            style={{ padding: '7px 14px', borderRadius: 'var(--radius-full)', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            {src.title}
          </button>
        ))}
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
                onClick={resume}
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
                    onClick={e => { e.stopPropagation(); removeWatchHistory(item.id, item.type); }}
                    className="interactive"
                    aria-label={`Remove ${item.title} from Continue Watching`}
                    style={{ position: 'absolute', top: '6px', right: '6px', zIndex: 2, width: '26px', height: '26px', borderRadius: '50%', border: 'none', backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <X size={14} />
                  </button>
                  <FadeImage src={item.backdrop || item.poster} alt={item.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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

      {seed && <BecauseYouWatched seed={seed} filter={mode} onSelectMedia={onSelectMedia} onPreview={setPreview} />}
      {history.length > 1 && (
        <PicksForYou seeds={history.slice(1, 4)} watched={watched} filter={mode} onSelectMedia={onSelectMedia} onPreview={setPreview} />
      )}

      {rails.map(source => (
        <LazyRail
          key={source.key}
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
