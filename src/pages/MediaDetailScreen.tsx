// MediaDetailScreen.tsx - Comprehensive Details, Cast, Seasons & Recommendations
import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Play,
  Bookmark,
  Check,
  Star,
  Clock,
  Film,
  Tv,
  Calendar,
  Sparkles,
  ChevronDown
} from 'lucide-react';
import {
  getMediaDetails,
  getTVSeasonEpisodes,
  type MediaItem,
  type MediaDetails,
  type EpisodeItem,
  type SeasonItem
} from '../core/cineHypeCore.ts';
import { isBookmarked, toggleBookmark } from '../services/historyService.ts';
import { FadeImage } from '../components/FadeImage.tsx';
import { MediaRail } from '../components/MediaRail.tsx';
import { TrailerModal } from '../components/TrailerModal.tsx';

interface MediaDetailScreenProps {
  media: MediaItem;
  onBack: () => void;
  onPlay: (item: MediaItem, season?: number, episode?: number, episodes?: EpisodeItem[]) => void;
  onSelectMedia: (item: MediaItem) => void;
}

export const MediaDetailScreen: React.FC<MediaDetailScreenProps> = ({
  media,
  onBack,
  onPlay,
  onSelectMedia
}) => {
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);

  const isSeries = media.mediaType === 'tv';

  // Load Bookmark state
  useEffect(() => {
    setBookmarked(isBookmarked(media.id, media.mediaType));
  }, [media.id, media.mediaType]);

  // Load Media Details
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getMediaDetails(media.id, media.mediaType)
      .then(d => {
        if (cancelled) return;
        setDetails(d);
        if (d.seasons && d.seasons.length > 0) {
          const firstSeasonNum = d.seasons[0].seasonNumber;
          setSelectedSeason(firstSeasonNum);
        }
      })
      .catch(err => {
        console.error('Failed to load details:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [media.id, media.mediaType]);

  // Load Season Episodes for TV
  useEffect(() => {
    if (!isSeries || !media.id) return;

    let cancelled = false;
    setLoadingEpisodes(true);

    getTVSeasonEpisodes(media.id, selectedSeason)
      .then(eps => {
        if (!cancelled) setEpisodes(eps);
      })
      .catch(err => {
        console.error('Failed to load season episodes:', err);
      })
      .finally(() => {
        if (!cancelled) setLoadingEpisodes(false);
      });

    return () => { cancelled = true; };
  }, [media.id, isSeries, selectedSeason]);

  const handleToggleBookmark = () => {
    const newState = toggleBookmark(media);
    setBookmarked(newState);
  };

  const year = media.releaseDate ? media.releaseDate.slice(0, 4) : '';
  const trailer = details?.trailers?.[0] || null;

  return (
    <div style={{ paddingBottom: '90px' }}>
      {/* Top Banner / Backdrop */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '56vh',
          minHeight: '380px',
          maxHeight: '520px',
          overflow: 'hidden',
          background: '#000'
        }}
      >
        <FadeImage
          src={details?.backdrop || media.backdrop || media.poster}
          alt={media.title}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'brightness(0.65)'
          }}
        />

        {/* Gradient overlays */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, var(--bg-main) 0%, rgba(10,11,15,0.6) 50%, rgba(10,11,15,0.85) 100%)'
          }}
        />

        {/* Back Button */}
        <button
          onClick={onBack}
          className="interactive"
          style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            zIndex: 10,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
      </div>

      {/* Main Details Body */}
      <div
        style={{
          maxWidth: '1200px',
          margin: '-160px auto 0 auto',
          padding: '0 24px',
          position: 'relative',
          zIndex: 5
        }}
      >
        <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
          {/* Poster */}
          <div
            style={{
              width: '240px',
              flexShrink: 0,
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
              border: '2px solid var(--border-subtle)',
              aspectRatio: '2/3'
            }}
          >
            <FadeImage src={details?.poster || media.poster} alt={media.title} />
          </div>

          {/* Info Column */}
          <div style={{ flex: '1 1 400px' }}>
            {/* Badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
              <span className="badge badge-red">
                {isSeries ? 'TV SERIES' : 'MOVIE'}
              </span>

              {year && (
                <span className="badge badge-glass">
                  <Calendar size={11} style={{ marginRight: 2 }} />
                  {year}
                </span>
              )}

              {details?.runtime && (
                <span className="badge badge-glass">
                  <Clock size={11} style={{ marginRight: 2 }} />
                  {details.runtime} min
                </span>
              )}

              {media.voteAverage > 0 && (
                <span
                  className="badge"
                  style={{
                    background: 'rgba(245, 158, 11, 0.2)',
                    color: 'var(--accent-gold)',
                    border: '1px solid rgba(245, 158, 11, 0.4)'
                  }}
                >
                  <Star size={11} fill="var(--accent-gold)" color="var(--accent-gold)" />
                  {media.voteAverage} / 10
                </span>
              )}
            </div>

            {/* Title */}
            <h1
              style={{
                fontSize: 'clamp(26px, 4vw, 40px)',
                fontWeight: 900,
                color: '#ffffff',
                lineHeight: 1.2,
                letterSpacing: '-0.5px',
                marginBottom: '6px'
              }}
            >
              {media.title}
            </h1>

            {details?.tagline && (
              <p style={{ fontSize: '14px', fontStyle: 'italic', color: 'var(--accent-secondary)', marginBottom: '14px' }}>
                "{details.tagline}"
              </p>
            )}

            {/* Genres */}
            {details?.genres && details.genres.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
                {details.genres.map(g => (
                  <span
                    key={g}
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-full)',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
              <button
                onClick={() => onPlay(media, isSeries ? selectedSeason : undefined, isSeries ? 1 : undefined, episodes)}
                className="btn-primary interactive"
                style={{ fontSize: '15px', padding: '12px 28px' }}
              >
                <Play size={18} fill="#ffffff" />
                <span>{isSeries ? 'Play S1 E1' : 'Play Movie'}</span>
              </button>

              {trailer && (
                <button
                  onClick={() => setShowTrailer(true)}
                  className="btn-secondary interactive"
                  style={{ fontSize: '14px' }}
                >
                  <Film size={16} />
                  <span>Trailer</span>
                </button>
              )}

              <button
                onClick={handleToggleBookmark}
                className="btn-secondary interactive"
                style={{
                  fontSize: '14px',
                  background: bookmarked ? 'rgba(229, 9, 20, 0.2)' : undefined,
                  borderColor: bookmarked ? 'var(--accent-primary)' : undefined
                }}
              >
                {bookmarked ? <Check size={16} color="var(--accent-primary)" /> : <Bookmark size={16} />}
                <span>{bookmarked ? 'In My List' : 'Add to List'}</span>
              </button>
            </div>

            {/* Synopsis */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Overview
              </h3>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: '750px' }}>
                {details?.overview || media.overview || 'No synopsis available for this title.'}
              </p>
            </div>
          </div>
        </div>

        {/* TV Series Seasons & Episodes Selector */}
        {isSeries && details?.seasons && details.seasons.length > 0 && (
          <div style={{ marginTop: '48px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Tv size={20} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Episodes
                </h3>
              </div>

              {/* Season Select Dropdown */}
              <select
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(Number(e.target.value))}
                style={{
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 700,
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {details.seasons.map(s => (
                  <option key={s.id} value={s.seasonNumber}>
                    {s.name || `Season ${s.seasonNumber}`} ({s.episodeCount} eps)
                  </option>
                ))}
              </select>
            </div>

            {/* Episodes Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '16px'
              }}
            >
              {episodes.map(ep => (
                <div
                  key={ep.id}
                  onClick={() => onPlay(media, selectedSeason, ep.episodeNumber, episodes)}
                  className="interactive"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ position: 'relative', width: '100%', height: '150px' }}>
                    <FadeImage src={ep.still || media.backdrop} alt={ep.name} />
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
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          background: 'var(--accent-gradient)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: 'var(--accent-glow)'
                        }}
                      >
                        <Play size={18} fill="#fff" color="#fff" style={{ marginLeft: 2 }} />
                      </div>
                    </div>

                    <div
                      style={{
                        position: 'absolute',
                        bottom: 8,
                        left: 8,
                        background: 'rgba(0,0,0,0.7)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 700
                      }}
                    >
                      EP {ep.episodeNumber}
                    </div>
                  </div>

                  <div style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <h4
                        style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {ep.name || `Episode ${ep.episodeNumber}`}
                      </h4>
                      {ep.runtime && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {ep.runtime}m
                        </span>
                      )}
                    </div>
                    <p
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        lineHeight: 1.5
                      }}
                    >
                      {ep.overview || 'Stream this episode now in high definition.'}
                    </p>
                  </div>
                </div>
              ))}

              {loadingEpisodes &&
                Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="skeleton"
                    style={{ width: '100%', height: '220px', borderRadius: 'var(--radius-md)' }}
                  />
                ))}
            </div>
          </div>
        )}

        {/* Cast & Crew Carousel */}
        {details?.cast && details.cast.length > 0 && (
          <div style={{ marginTop: '48px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '16px' }}>
              Cast & Characters
            </h3>
            <div className="rail" style={{ gap: '14px', paddingBottom: '8px' }}>
              {details.cast.map(c => (
                <div
                  key={c.id}
                  style={{
                    flex: '0 0 100px',
                    width: '100px',
                    textAlign: 'center'
                  }}
                >
                  <div
                    style={{
                      width: '84px',
                      height: '84px',
                      borderRadius: '50%',
                      overflow: 'hidden',
                      margin: '0 auto 8px auto',
                      border: '2px solid var(--border-subtle)',
                      background: 'var(--bg-surface)'
                    }}
                  >
                    <FadeImage src={c.profile} alt={c.name} />
                  </div>
                  <h5 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name}
                  </h5>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.character}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations / More Like This */}
        {details?.recommendations && details.recommendations.length > 0 && (
          <div style={{ marginTop: '48px' }}>
            <MediaRail
              title="More Like This"
              subtitle="Recommendations based on this title"
              items={details.recommendations}
              onSelect={onSelectMedia}
            />
          </div>
        )}
      </div>

      {/* Official YouTube Trailer Modal */}
      {showTrailer && (
        <TrailerModal
          trailer={trailer}
          title={media.title}
          onClose={() => setShowTrailer(false)}
        />
      )}
    </div>
  );
};
