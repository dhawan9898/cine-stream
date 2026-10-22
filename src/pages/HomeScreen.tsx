// HomeScreen.tsx - CineStream Home Showcase with Hero & Genre Rails
import React, { useState, useEffect } from 'react';
import { Play, Sparkles, Clock, Star, Flame, Tv, Film } from 'lucide-react';
import {
  getTrending,
  getPopularMovies,
  getPopularTV,
  getTopRatedMovies,
  getOnTheAirTV,
  discoverByGenre,
  type MediaItem
} from '../core/cineHypeCore.ts';
import { getWatchHistory, type WatchHistoryItem, subscribeLibraryChanges } from '../services/historyService.ts';
import { HeroCarousel } from '../components/HeroCarousel.tsx';
import { MediaRail } from '../components/MediaRail.tsx';
import { FadeImage } from '../components/FadeImage.tsx';

interface HomeScreenProps {
  onSelectMedia: (item: MediaItem) => void;
  onPlayMedia: (item: MediaItem, season?: number, episode?: number) => void;
  onOpenExplore: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onSelectMedia,
  onPlayMedia,
  onOpenExplore
}) => {
  const [trending, setTrending] = useState<MediaItem[]>([]);
  const [popularMovies, setPopularMovies] = useState<MediaItem[] | null>(null);
  const [popularTV, setPopularTV] = useState<MediaItem[] | null>(null);
  const [topRated, setTopRated] = useState<MediaItem[] | null>(null);
  const [onTheAir, setOnTheAir] = useState<MediaItem[] | null>(null);
  const [actionMovies, setActionMovies] = useState<MediaItem[] | null>(null);
  const [scifiMovies, setScifiMovies] = useState<MediaItem[] | null>(null);
  const [comedyMovies, setComedyMovies] = useState<MediaItem[] | null>(null);
  const [animationMovies, setAnimationMovies] = useState<MediaItem[] | null>(null);
  const [history, setHistory] = useState<WatchHistoryItem[]>([]);

  // Load Watch History
  useEffect(() => {
    setHistory(getWatchHistory());
    return subscribeLibraryChanges(() => {
      setHistory(getWatchHistory());
    });
  }, []);

  // Load Content
  useEffect(() => {
    getTrending('all', 'week').then(items => setTrending(items)).catch(() => {});
    getPopularMovies(1).then(items => setPopularMovies(items)).catch(() => {});
    getPopularTV(1).then(items => setPopularTV(items)).catch(() => {});
    getTopRatedMovies(1).then(items => setTopRated(items)).catch(() => {});
    getOnTheAirTV(1).then(items => setOnTheAir(items)).catch(() => {});

    // Genre rails
    discoverByGenre(28, 'movie', 1).then(items => setActionMovies(items)).catch(() => {});
    discoverByGenre(878, 'movie', 1).then(items => setScifiMovies(items)).catch(() => {});
    discoverByGenre(35, 'movie', 1).then(items => setComedyMovies(items)).catch(() => {});
    discoverByGenre(16, 'movie', 1).then(items => setAnimationMovies(items)).catch(() => {});
  }, []);

  return (
    <div style={{ paddingBottom: '80px' }}>
      {/* Hero Carousel */}
      <HeroCarousel
        items={trending}
        onPlay={item => onPlayMedia(item)}
        onOpenDetails={item => onSelectMedia(item)}
      />

      {/* Continue Watching Rail (if any) */}
      {history.length > 0 && (
        <div style={{ marginTop: '24px', marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 24px', marginBottom: '14px' }}>
            <Clock size={18} color="var(--accent-primary)" />
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Continue Watching
            </h3>
          </div>

          <div className="rail" style={{ gap: '14px', padding: '0 24px 8px 24px' }}>
            {history.map(item => (
              <div
                key={`${item.type}-${item.id}`}
                onClick={() => {
                  const media: MediaItem = {
                    id: item.id,
                    title: item.title,
                    mediaType: item.type,
                    poster: item.poster,
                    backdrop: item.backdrop,
                    overview: '',
                    releaseDate: '',
                    voteAverage: 0
                  };
                  onPlayMedia(media, item.season, item.episode);
                }}
                className="interactive"
                style={{
                  flex: '0 0 220px',
                  width: '220px',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer'
                }}
              >
                <div style={{ position: 'relative', width: '100%', height: '124px' }}>
                  <FadeImage src={item.backdrop || item.poster} alt={item.title} />

                  {/* Play Button Overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(0,0,0,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: '50%',
                        background: 'var(--accent-gradient)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: 'var(--accent-glow)'
                      }}
                    >
                      <Play size={16} fill="#fff" color="#fff" style={{ marginLeft: 2 }} />
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '4px',
                      background: 'rgba(255,255,255,0.2)'
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${item.progressPercent || 30}%`,
                        background: 'var(--accent-primary)'
                      }}
                    />
                  </div>
                </div>

                <div style={{ padding: '10px 12px' }}>
                  <h4
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {item.title}
                  </h4>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {item.type === 'tv' ? `S${item.season || 1} E${item.episode || 1}` : 'Resume Movie'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content Rails */}
      <MediaRail
        title="Trending Movies"
        subtitle="Most watched feature films right now"
        items={popularMovies}
        onSelect={onSelectMedia}
        onSeeAll={onOpenExplore}
      />

      <MediaRail
        title="Trending TV Series"
        subtitle="Binge-worthy shows on CineHype"
        items={popularTV}
        onSelect={onSelectMedia}
        onSeeAll={onOpenExplore}
      />

      <MediaRail
        title="New Episodes On The Air"
        subtitle="Fresh television broadcast releases"
        items={onTheAir}
        onSelect={onSelectMedia}
        onSeeAll={onOpenExplore}
      />

      <MediaRail
        title="Top Rated All Time"
        subtitle="Critically acclaimed cinematic masterpieces"
        items={topRated}
        onSelect={onSelectMedia}
        onSeeAll={onOpenExplore}
      />

      <MediaRail
        title="Action & High-Octane"
        subtitle="Explosive fights, thrilling chases, and blockbusters"
        items={actionMovies}
        onSelect={onSelectMedia}
        onSeeAll={onOpenExplore}
      />

      <MediaRail
        title="Sci-Fi & Future Worlds"
        subtitle="Mind-bending adventures across spacetime"
        items={scifiMovies}
        onSelect={onSelectMedia}
        onSeeAll={onOpenExplore}
      />

      <MediaRail
        title="Animation & Family"
        subtitle="Stunning visual stories for all audiences"
        items={animationMovies}
        onSelect={onSelectMedia}
        onSeeAll={onOpenExplore}
      />

      <MediaRail
        title="Comedy & Entertainment"
        subtitle="Laughs, humor, and witty stories"
        items={comedyMovies}
        onSelect={onSelectMedia}
        onSeeAll={onOpenExplore}
      />
    </div>
  );
};
