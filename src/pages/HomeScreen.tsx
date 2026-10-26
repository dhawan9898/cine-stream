// HomeScreen.tsx - Netflix-style home: hero banner, Continue Watching and
// poster rails. Rails below the fold load when scrolled near.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Flame, Clock, ChevronRight, ChevronDown, Search as SearchIcon, Star, Tv, Film, Zap, Smile, Rocket } from 'lucide-react';
import { getTrending, type MediaItem, type MediaType } from '../core/cineHypeCore.ts';
import { getWatchHistory, subscribeLibraryChanges, type WatchHistoryItem } from '../services/historyService.ts';
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

const RAILS: { source: BrowseSource; icon: React.ReactNode }[] = [
  { source: POPULAR_MOVIES, icon: <Flame size={18} color="#f43f5e" /> },
  { source: TELUGU_MOVIES, icon: <Film size={18} color="var(--accent-primary)" /> },
  { source: TAMIL_MOVIES, icon: <Film size={18} color="var(--accent-amber)" /> },
  { source: HINDI_MOVIES, icon: <Film size={18} color="var(--accent-cyan)" /> },
  { source: MALAYALAM_MOVIES, icon: <Film size={18} color="#e11d48" /> },
  { source: POPULAR_TV, icon: <Tv size={18} color="var(--accent-primary)" /> },
  { source: TOP_RATED_MOVIES, icon: <Star size={18} color="var(--accent-amber)" /> },
  { source: ON_THE_AIR, icon: <Zap size={18} color="var(--accent-cyan)" /> },
  { source: genreSource({ id: 28, name: 'Action' }, 'movie'), icon: <Film size={18} color="var(--accent-primary)" /> },
  { source: genreSource({ id: 878, name: 'Sci-Fi' }, 'movie'), icon: <Rocket size={18} color="var(--accent-cyan)" /> },
  { source: genreSource({ id: 35, name: 'Comedy' }, 'movie'), icon: <Smile size={18} color="var(--accent-amber)" /> }
];

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

export const HomeScreen: React.FC<HomeScreenProps> = ({ onSelectMedia, onPlayMedia, onOpenSearch, onOpenSource, paused }) => {
  const [trending, setTrending] = useState<MediaItem[]>([]);
  const [trendingError, setTrendingError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<WatchHistoryItem[]>(() => getWatchHistory());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerType, setPickerType] = useState<MediaType>('movie');

  useEffect(() => subscribeLibraryChanges(() => setHistory(getWatchHistory())), []);

  useEffect(() => {
    let cancelled = false;
    getTrending('all', 'week')
      .then(items => { if (!cancelled) { setTrending(items); setTrendingError(false); } })
      .catch(() => { if (!cancelled) setTrendingError(true); });
    return () => { cancelled = true; };
  }, [attempt]);

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

      {trendingError ? (
        <div style={{ paddingTop: 'calc(var(--safe-top) + 40px)' }}>
          <ErrorState message="Couldn't load movies and shows. Check your connection and try again." onRetry={retry} />
        </div>
      ) : (
        <HeroCarousel items={trending} onPlay={item => onPlayMedia(item)} onOpenDetails={onSelectMedia} paused={paused} />
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
            {history.map(item => (
              <div
                key={`${item.type}-${item.id}`}
                onClick={() => onPlayMedia({
                  id: item.id,
                  title: item.title,
                  mediaType: item.type,
                  poster: item.poster,
                  backdrop: item.backdrop,
                  overview: '',
                  releaseDate: '',
                  voteAverage: 0
                }, item.season, item.episode)}
                className="interactive glass-panel"
                style={{ flex: '0 0 200px', borderRadius: 'var(--radius-md)', overflow: 'hidden', position: 'relative' }}
              >
                <div style={{ position: 'relative', height: '110px' }}>
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
            ))}
          </div>
        </div>
      )}

      {RAILS.map(({ source, icon }) => (
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
