// HomeScreen.tsx - Netflix-style home: hero banner, Continue Watching and
// poster rails. Rails below the fold load when scrolled near.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Flame, Clock, ChevronRight, ChevronDown, Search as SearchIcon, Star, Tv, Film, Zap, Smile, Rocket, X, Heart, Sparkles, Ghost, Drama } from 'lucide-react';
import { getTrending, getRecommendations, type MediaItem, type MediaType } from '../core/cineHypeCore.ts';
import { getWatchHistory, getBookmarks, removeWatchHistory, subscribeLibraryChanges, type WatchHistoryItem } from '../services/historyService.ts';
import {
  genreSource,
  ON_THE_AIR,
  POPULAR_MOVIES,
  POPULAR_TV,
  TOP_RATED_MOVIES,
  TELUGU_MOVIES,
  TAMIL_MOVIES,
  HINDI_MOVIES,
  MALAYALAM_MOVIES,
  TOP_RATED_TV,
  TRENDING_MOVIES,
  TRENDING_TV,
  TRENDING_ALL,
  languageSource,
  type BrowseSource
} from '../services/browseSources.ts';
import { HeroCarousel } from '../components/HeroCarousel.tsx';
import { PosterCard } from '../components/PosterCard.tsx';
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

type HomeMode = 'all' | 'movie' | 'tv';

const MODES: { id: HomeMode; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'TV Shows' }
];

type RailDef = { source: BrowseSource; icon: React.ReactNode };

const g = (id: number, name: string, type: MediaType, icon: React.ReactNode): RailDef => ({ source: genreSource({ id, name }, type), icon });
const dot = (color: string) => <Film size={18} color={color} />;

// Rails per tab, in display order. Personal rows (My List, Because You
// Watched, Top 10) are inserted around these by HomeScreen.
const RAILS: Record<HomeMode, RailDef[]> = {
  all: [
    { source: POPULAR_MOVIES, icon: <Flame size={18} color="#f43f5e" /> },
    { source: POPULAR_TV, icon: <Tv size={18} color="var(--accent-primary)" /> },
    { source: TELUGU_MOVIES, icon: dot('var(--accent-primary)') },
    { source: HINDI_MOVIES, icon: dot('var(--accent-cyan)') },
    { source: TAMIL_MOVIES, icon: dot('var(--accent-amber)') },
    { source: MALAYALAM_MOVIES, icon: dot('#e11d48') },
    { source: TOP_RATED_MOVIES, icon: <Star size={18} color="var(--accent-amber)" /> },
    { source: ON_THE_AIR, icon: <Zap size={18} color="var(--accent-cyan)" /> },
    g(28, 'Action', 'movie', dot('var(--accent-primary)')),
    g(35, 'Comedy', 'movie', <Smile size={18} color="var(--accent-amber)" />),
    g(10749, 'Romance', 'movie', <Heart size={18} color="#f43f5e" />),
    g(878, 'Sci-Fi', 'movie', <Rocket size={18} color="var(--accent-cyan)" />),
    g(27, 'Horror', 'movie', <Ghost size={18} color="var(--text-secondary)" />),
    g(18, 'Drama', 'tv', <Drama size={18} color="var(--accent-amber)" />)
  ],
  movie: [
    { source: POPULAR_MOVIES, icon: <Flame size={18} color="#f43f5e" /> },
    { source: TOP_RATED_MOVIES, icon: <Star size={18} color="var(--accent-amber)" /> },
    { source: TELUGU_MOVIES, icon: dot('var(--accent-primary)') },
    { source: HINDI_MOVIES, icon: dot('var(--accent-cyan)') },
    { source: TAMIL_MOVIES, icon: dot('var(--accent-amber)') },
    { source: MALAYALAM_MOVIES, icon: dot('#e11d48') },
    g(28, 'Action', 'movie', dot('var(--accent-primary)')),
    g(35, 'Comedy', 'movie', <Smile size={18} color="var(--accent-amber)" />),
    g(53, 'Thriller', 'movie', <Zap size={18} color="var(--accent-cyan)" />),
    g(10749, 'Romance', 'movie', <Heart size={18} color="#f43f5e" />),
    g(878, 'Sci-Fi', 'movie', <Rocket size={18} color="var(--accent-cyan)" />),
    g(27, 'Horror', 'movie', <Ghost size={18} color="var(--text-secondary)" />),
    g(16, 'Animation', 'movie', <Sparkles size={18} color="var(--accent-amber)" />)
  ],
  tv: [
    { source: POPULAR_TV, icon: <Tv size={18} color="var(--accent-primary)" /> },
    { source: ON_THE_AIR, icon: <Zap size={18} color="var(--accent-cyan)" /> },
    { source: TOP_RATED_TV, icon: <Star size={18} color="var(--accent-amber)" /> },
    g(10759, 'Action & Adventure', 'tv', dot('var(--accent-primary)')),
    g(18, 'Drama', 'tv', <Drama size={18} color="var(--accent-amber)" />),
    g(35, 'Comedy', 'tv', <Smile size={18} color="var(--accent-amber)" />),
    g(80, 'Crime', 'tv', <Zap size={18} color="var(--accent-cyan)" />),
    g(10765, 'Sci-Fi & Fantasy', 'tv', <Rocket size={18} color="var(--accent-cyan)" />),
    g(16, 'Animation', 'tv', <Sparkles size={18} color="var(--accent-amber)" />)
  ]
};

// Quick-jump chips next to the tabs: one tap to a full category page.
const QUICK_CHIPS: BrowseSource[] = [
  languageSource({ code: 'te', name: 'Telugu' }, 'movie'),
  languageSource({ code: 'hi', name: 'Hindi' }, 'movie'),
  languageSource({ code: 'ta', name: 'Tamil' }, 'movie'),
  languageSource({ code: 'ml', name: 'Malayalam' }, 'movie'),
  genreSource({ id: 28, name: 'Action' }, 'movie'),
  genreSource({ id: 35, name: 'Comedy' }, 'movie'),
  genreSource({ id: 10749, name: 'Romance' }, 'movie'),
  genreSource({ id: 53, name: 'Thriller' }, 'movie'),
  genreSource({ id: 27, name: 'Horror' }, 'movie'),
  genreSource({ id: 16, name: 'Animation' }, 'movie')
].map(src => ({ ...src, title: src.title.replace(/ (Movies|TV Shows|TV)$/, '') }));

const RailHeader: React.FC<{ icon: React.ReactNode; title: string; onSeeAll: () => void }> = ({ icon, title, onSeeAll }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', marginBottom: '10px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      {icon}
      <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)' }}>{title}</h2>
    </div>
    <button
      onClick={onSeeAll}
      className="interactive"
      style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}
    >
      <span>See all</span>
      <ChevronRight size={16} />
    </button>
  </div>
);

// One rail that fetches its first page only once it nears the viewport.
const LazyRail: React.FC<{
  source: BrowseSource;
  icon: React.ReactNode;
  onSelectMedia: (m: MediaItem) => void;
  onSeeAll: () => void;
}> = ({ source, icon, onSelectMedia, onSeeAll }) => {
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

  if (failed) return null;
  return (
    <div ref={holder} style={{ padding: '18px 0 4px 0', minHeight: '220px' }}>
      <RailHeader icon={icon} title={source.title} onSeeAll={onSeeAll} />
      <div className="rail" style={{ gap: '10px', padding: '0 20px 6px 20px' }}>
        {items === null
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ flex: '0 0 112px', height: '162px', borderRadius: '6px' }} />
            ))
          : items.map(m => (
              <PosterCard key={`${m.mediaType}-${m.id}`} media={m} width={112} onClick={() => onSelectMedia(m)} />
            ))}
      </div>
    </div>
  );
};

// Rail whose items are already known (My List, Top 10, recommendations).
const ItemRail: React.FC<{
  icon: React.ReactNode;
  title: string;
  items: MediaItem[];
  onSelectMedia: (m: MediaItem) => void;
  onSeeAll?: () => void;
  ranked?: boolean;
}> = ({ icon, title, items, onSelectMedia, onSeeAll, ranked }) => (
  <div style={{ padding: '18px 0 4px 0' }}>
    {onSeeAll
      ? <RailHeader icon={icon} title={title} onSeeAll={onSeeAll} />
      : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 20px', marginBottom: '10px' }}>
          {icon}
          <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)' }}>{title}</h2>
        </div>
      )}
    <div className="rail" style={{ gap: ranked ? '4px' : '10px', padding: '0 20px 6px 20px' }}>
      {items.map((m, i) => ranked ? (
        <div key={`${m.mediaType}-${m.id}`} className="top10-item">
          <span className="top10-num">{i + 1}</span>
          <PosterCard media={m} width={104} onClick={() => onSelectMedia(m)} />
        </div>
      ) : (
        <PosterCard key={`${m.mediaType}-${m.id}`} media={m} width={112} onClick={() => onSelectMedia(m)} />
      ))}
    </div>
  </div>
);

// "Because you watched X": TMDB recommendations for the latest title in history.
const BecauseYouWatched: React.FC<{ seed: WatchHistoryItem; onSelectMedia: (m: MediaItem) => void }> = ({ seed, onSelectMedia }) => {
  const [items, setItems] = useState<MediaItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    setItems([]);
    getRecommendations(seed.id, seed.type)
      .then(list => { if (!cancelled) setItems(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [seed.id, seed.type]);
  if (items.length < 4) return null;
  return (
    <ItemRail
      icon={<Sparkles size={18} color="var(--accent-primary)" />}
      title={`Because you watched ${seed.title}`}
      items={items}
      onSelectMedia={onSelectMedia}
    />
  );
};

// "Top picks for you": recommendations blended from the last few titles
// watched, minus anything already in history, best-rated first.
const PicksForYou: React.FC<{ seeds: WatchHistoryItem[]; watched: Set<string>; onSelectMedia: (m: MediaItem) => void }> = ({ seeds, watched, onSelectMedia }) => {
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
  if (items.length < 4) return null;
  return (
    <ItemRail
      icon={<Sparkles size={18} color="var(--accent-amber)" />}
      title="Top Picks for You"
      items={items}
      onSelectMedia={onSelectMedia}
    />
  );
};

export const HomeScreen: React.FC<HomeScreenProps> = ({ onSelectMedia, onPlayMedia, onOpenSearch, onOpenSource, paused }) => {
  const [trending, setTrending] = useState<MediaItem[]>([]);
  const [trendingError, setTrendingError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<WatchHistoryItem[]>(() => getWatchHistory());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerType, setPickerType] = useState<MediaType>('movie');
  const [mode, setMode] = useState<HomeMode>('all');
  const [myList, setMyList] = useState<MediaItem[]>(() => getBookmarks());

  useEffect(() => subscribeLibraryChanges(() => { setHistory(getWatchHistory()); setMyList(getBookmarks()); }), []);

  useEffect(() => {
    let cancelled = false;
    setTrending([]);
    getTrending(mode, 'week')
      .then(items => { if (!cancelled) { setTrending(items); setTrendingError(false); } })
      .catch(() => { if (!cancelled) setTrendingError(true); });
    return () => { cancelled = true; };
  }, [attempt, mode]);

  const seed = history.find(h => h.progressPercent > 5);
  const top10Source = mode === 'tv' ? TRENDING_TV : mode === 'movie' ? TRENDING_MOVIES : TRENDING_ALL;

  const retry = useCallback(() => { setTrendingError(false); setAttempt(n => n + 1); }, []);

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
            onClick={() => setPickerOpen(true)}
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
        {QUICK_CHIPS.map(src => (
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
              <Clock size={18} color="var(--accent-primary)" />
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
          icon={<Heart size={18} color="#f43f5e" />}
          title="My List"
          items={myList}
          onSelectMedia={onSelectMedia}
        />
      )}

      {trending.length >= 5 && (
        <ItemRail
          icon={<Flame size={18} color="#f43f5e" />}
          title={mode === 'tv' ? 'Top 10 TV Shows This Week' : mode === 'movie' ? 'Top 10 Movies This Week' : 'Top 10 Today'}
          items={trending.slice(0, 10)}
          onSelectMedia={onSelectMedia}
          onSeeAll={() => onOpenSource(top10Source)}
          ranked
        />
      )}

      {seed && <BecauseYouWatched seed={seed} onSelectMedia={onSelectMedia} />}
      {history.length > 1 && (
        <PicksForYou
          seeds={history.slice(1, 4)}
          watched={new Set(history.map(h => `${h.type}-${h.id}`))}
          onSelectMedia={onSelectMedia}
        />
      )}

      {RAILS[mode].map(({ source, icon }) => (
        <LazyRail
          key={source.key}
          source={source}
          icon={icon}
          onSelectMedia={onSelectMedia}
          onSeeAll={() => onOpenSource(source)}
        />
      ))}

      <GenrePicker
        open={pickerOpen}
        type={pickerType}
        onTypeChange={setPickerType}
        onClose={() => setPickerOpen(false)}
        onSelect={(genre, type) => { setPickerOpen(false); onOpenSource(genreSource(genre, type)); }}
      />
    </div>
  );
};
