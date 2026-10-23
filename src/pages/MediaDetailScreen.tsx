// MediaDetailScreen.tsx - Title page: banner, Play/Resume, My List, trailer,
// and tabs for episodes, cast and recommendations.
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Clapperboard, Loader2, Play, Plus } from 'lucide-react';
import {
  getMediaDetails,
  getTVSeasonEpisodes,
  type EpisodeItem,
  type MediaDetails,
  type MediaItem
} from '../core/cineHypeCore.ts';
import { getWatchHistory, isBookmarked, subscribeLibraryChanges, toggleBookmark, type WatchHistoryItem } from '../services/historyService.ts';
import { FadeImage } from '../components/FadeImage.tsx';
import { PosterCard } from '../components/PosterCard.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { TrailerModal } from '../components/TrailerModal.tsx';

interface MediaDetailScreenProps {
  media: MediaItem;
  onBack: () => void;
  onPlay: (item: MediaItem, season?: number, episode?: number, episodes?: EpisodeItem[]) => void;
  onSelectMedia: (item: MediaItem) => void;
}

type DetailTab = 'episodes' | 'similar' | 'cast';

const findHistory = (m: MediaItem): WatchHistoryItem | undefined =>
  getWatchHistory().find(h => h.id === m.id && h.type === m.mediaType);

export const MediaDetailScreen: React.FC<MediaDetailScreenProps> = ({ media, onBack, onPlay, onSelectMedia }) => {
  const isSeries = media.mediaType === 'tv';
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [detailsError, setDetailsError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [season, setSeason] = useState(1);
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(isSeries);
  const [episodesError, setEpisodesError] = useState(false);
  const [saved, setSaved] = useState(() => isBookmarked(media.id, media.mediaType));
  const [history, setHistory] = useState(() => findHistory(media));
  const [tab, setTab] = useState<DetailTab>(isSeries ? 'episodes' : 'similar');
  const [expanded, setExpanded] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);

  useEffect(() => subscribeLibraryChanges(() => {
    setSaved(isBookmarked(media.id, media.mediaType));
    setHistory(findHistory(media));
  }), [media]);

  // Resume on the season the viewer was last in.
  useEffect(() => {
    if (history?.season) setSeason(history.season);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDetailsError(false);
    getMediaDetails(media.id, media.mediaType)
      .then(d => {
        if (cancelled) return;
        setDetails(d);
        if (!history?.season && d.seasons && d.seasons.length > 0) setSeason(d.seasons[0].seasonNumber);
      })
      .catch(() => { if (!cancelled) setDetailsError(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id, media.mediaType, attempt]);

  useEffect(() => {
    if (!isSeries) return;
    let cancelled = false;
    setLoadingEpisodes(true);
    setEpisodesError(false);
    getTVSeasonEpisodes(media.id, season)
      .then(eps => { if (!cancelled) setEpisodes(eps); })
      .catch(() => { if (!cancelled) setEpisodesError(true); })
      .finally(() => { if (!cancelled) setLoadingEpisodes(false); });
    return () => { cancelled = true; };
  }, [media.id, isSeries, season, attempt]);

  const shown: MediaItem = details ?? media;
  const year = shown.releaseDate ? shown.releaseDate.slice(0, 4) : '';
  const genres = details?.genres ?? [];
  const trailer = details?.trailers?.[0] ?? null;
  const cast = details?.cast ?? [];
  const similar = details?.recommendations ?? [];
  const seasons = details?.seasons?.filter(s => s.seasonNumber > 0) ?? [];

  const metaParts = [
    isSeries ? 'Series' : 'Movie',
    year,
    shown.runtime ? `${shown.runtime} min` : null,
    isSeries && shown.numberOfSeasons ? `${shown.numberOfSeasons} Season${shown.numberOfSeasons === 1 ? '' : 's'}` : null,
    shown.voteAverage > 0 ? `★ ${shown.voteAverage}` : null
  ].filter(Boolean);

  const playLabel = history
    ? (isSeries && history.season ? `Resume S${history.season}:E${history.episode}` : 'Resume')
    : isSeries ? 'Play S1:E1' : 'Play';

  const handlePlay = () => {
    if (isSeries) {
      const s = history?.season ?? 1;
      const e = history?.episode ?? 1;
      onPlay(media, s, e, s === season ? episodes : []);
    } else {
      onPlay(media);
    }
  };

  const tabs: { id: DetailTab; label: string }[] = [
    ...(isSeries ? [{ id: 'episodes' as DetailTab, label: 'Episodes' }] : []),
    { id: 'similar', label: 'More Like This' },
    ...(cast.length > 0 ? [{ id: 'cast' as DetailTab, label: 'Cast' }] : [])
  ];
  const activeTab = tabs.some(t => t.id === tab) ? tab : tabs[0].id;

  return (
    <div className="screen-scroll" style={{ paddingBottom: '40px', position: 'relative' }}>
      <div style={{ position: 'relative', width: '100%', height: '280px' }}>
        <FadeImage src={shown.backdrop || shown.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(11,11,13,0.55) 0%, rgba(11,11,13,0.82) 70%, var(--bg-main) 100%)' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 'calc(var(--safe-top) + 12px) 20px 0 20px', zIndex: 20 }}>
          <button
            onClick={onBack}
            className="interactive glass-pill-dark"
            aria-label="Back"
            style={{ width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <ArrowLeft size={20} />
          </button>
        </div>
      </div>

      <div style={{ padding: '0 20px', marginTop: '-70px', position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '14px' }}>
          <FadeImage
            src={shown.poster}
            alt={shown.title}
            style={{ width: '104px', height: '150px', objectFit: 'cover', borderRadius: '6px', boxShadow: '0 8px 24px rgba(0,0,0,0.7)', flexShrink: 0 }}
          />
          <div style={{ flex: 1, paddingBottom: '4px', minWidth: 0 }}>
            <h1 style={{ fontSize: '21px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: '1.25' }}>{shown.title}</h1>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px', fontWeight: 600 }}>
              {metaParts.join('  •  ')}
            </div>
          </div>
        </div>

        <button
          onClick={handlePlay}
          className="interactive"
          style={{ width: '100%', padding: '12px', borderRadius: '6px', background: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#000', fontSize: '15px', fontWeight: 800, marginBottom: '10px' }}
        >
          <Play size={20} fill="#000" />
          <span>{playLabel}</span>
        </button>

        {history && history.progressPercent > 0 && history.progressPercent < 98 && (
          <div style={{ height: '3px', backgroundColor: 'rgba(127,127,127,0.35)', borderRadius: '2px', marginBottom: '12px' }}>
            <div style={{ width: `${history.progressPercent}%`, height: '100%', backgroundColor: 'var(--accent-primary)', borderRadius: '2px' }} />
          </div>
        )}

        {detailsError && (
          <ErrorState compact message="Couldn't load all details." onRetry={() => setAttempt(n => n + 1)} />
        )}

        {shown.overview && (
          <p
            onClick={() => setExpanded(e => !e)}
            style={{
              fontSize: '13px',
              color: 'var(--text-primary)',
              opacity: 0.85,
              lineHeight: '1.5',
              marginBottom: '8px',
              display: expanded ? 'block' : '-webkit-box',
              WebkitLineClamp: expanded ? undefined : 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden'
            }}
          >
            {shown.overview}
          </p>
        )}
        {genres.length > 0 && (
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            <span style={{ fontWeight: 700 }}>Genres: </span>{genres.join(', ')}
          </p>
        )}

        <div style={{ display: 'flex', gap: '28px', marginBottom: '18px' }}>
          <button
            onClick={() => toggleBookmark(media)}
            className="interactive"
            style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: 'var(--text-primary)', fontSize: '11px', fontWeight: 600 }}
          >
            {saved ? <Check size={22} /> : <Plus size={22} />}
            <span style={{ color: 'var(--text-secondary)' }}>My List</span>
          </button>
          {trailer && (
            <button
              onClick={() => setTrailerOpen(true)}
              className="interactive"
              style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: 'var(--text-primary)', fontSize: '11px', fontWeight: 600 }}
            >
              <Clapperboard size={22} />
              <span style={{ color: 'var(--text-secondary)' }}>Trailer</span>
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '22px', borderTop: '1px solid var(--border-subtle)', marginBottom: '16px', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {tabs.map(t => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderTop: `4px solid ${active ? 'var(--accent-primary)' : 'transparent'}`,
                  padding: '10px 0 0 0',
                  marginTop: '-1px',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: '13px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer'
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'episodes' && (
          <>
            {seasons.length > 1 && (
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', scrollbarWidth: 'none' }}>
                {seasons.map(s => (
                  <button
                    key={s.seasonNumber}
                    onClick={() => setSeason(s.seasonNumber)}
                    className={`interactive glass-pill chip ${season === s.seasonNumber ? 'active' : ''}`}
                    style={{ padding: '6px 14px', borderRadius: 'var(--radius-full)', color: season === s.seasonNumber ? undefined : 'var(--text-secondary)', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' }}
                  >
                    {s.name || `Season ${s.seasonNumber}`}
                  </button>
                ))}
              </div>
            )}

            {episodesError && !loadingEpisodes ? (
              <ErrorState compact message="Couldn't load the episode list." onRetry={() => setAttempt(n => n + 1)} />
            ) : loadingEpisodes ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: '10px', color: 'var(--text-secondary)' }}>
                <Loader2 size={24} className="animate-spin" />
                <span style={{ fontSize: '14px' }}>Fetching episodes...</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {episodes.map(ep => {
                  const current = history?.season === ep.seasonNumber && history.episode === ep.episodeNumber;
                  return (
                    <button
                      key={ep.id}
                      onClick={() => onPlay(media, ep.seasonNumber, ep.episodeNumber, episodes)}
                      className="interactive glass-panel"
                      style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', gap: '12px', padding: '10px', alignItems: 'center', textAlign: 'left' }}
                    >
                      <div style={{ position: 'relative', width: '112px', height: '63px', borderRadius: '6px', overflow: 'hidden', flexShrink: 0, backgroundColor: 'rgba(127,127,127,0.15)' }}>
                        {ep.still && <FadeImage src={ep.still} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' }}>
                          <Play size={16} fill="#fff" color="#fff" />
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {ep.episodeNumber}. {ep.name}
                        </div>
                        <div style={{ fontSize: '11px', color: current ? 'var(--accent-primary)' : 'var(--text-secondary)', marginTop: '3px', fontWeight: 600 }}>
                          {current ? 'Resume' : ep.runtime ? `${ep.runtime} min` : 'Play'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === 'similar' && (
          details === null && !detailsError ? (
            <div className="grid-collection">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ borderRadius: '6px', paddingTop: '145%' }} />
              ))}
            </div>
          ) : similar.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-secondary)', fontSize: '13px' }}>No suggestions found for this title.</p>
          ) : (
            <div className="grid-collection">
              {similar.map(item => (
                <PosterCard key={`${item.mediaType}-${item.id}`} media={item} onClick={() => onSelectMedia(item)} />
              ))}
            </div>
          )
        )}

        {activeTab === 'cast' && (
          <div className="grid-collection">
            {cast.map(c => (
              <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ position: 'relative', width: '100%', paddingTop: '100%', borderRadius: '50%', overflow: 'hidden', backgroundColor: 'rgba(127,127,127,0.15)' }}>
                  {c.profile && <FadeImage src={c.profile} alt={c.name} loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>{c.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.25 }}>{c.character}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <TrailerModal trailer={trailerOpen ? trailer : null} title={shown.title} onClose={() => setTrailerOpen(false)} />
    </div>
  );
};
