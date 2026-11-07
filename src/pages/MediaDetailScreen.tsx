// MediaDetailScreen.tsx - Title page: banner, Play/Resume, My List, trailer,
// and tabs for episodes, cast and recommendations.
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Clapperboard, ChevronDown, Download, Loader2, Play, Plus, RotateCw } from 'lucide-react';
import { CategoryPicker, type CategorySection } from 'streamkit/ui/CategoryPicker.tsx';
import {
  getMediaDetails,
  getTVSeasonEpisodes,
  type EpisodeItem,
  type MediaDetails,
  type MediaItem
} from '../providers/cineHypeCore.ts';
import { getWatchHistory, isBookmarked, subscribeLibraryChanges, toggleBookmark, type WatchHistoryItem } from '../services/historyService.ts';
import { prefetchStream } from '../providers/streamResolver.ts';
import { FadeImage } from 'streamkit/ui/FadeImage.tsx';
import { PosterCard } from '../components/PosterCard.tsx';
import { ErrorState } from 'streamkit/ui/ErrorState.tsx';
import { TrailerModal } from '../components/TrailerModal.tsx';
import { DownloadButton } from '../components/DownloadButton.tsx';
import { downloadsSupported, downloadId, startDownload, removeDownload } from '../services/downloadService.ts';
import { useDownloads } from '../services/useDownloads.ts';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '../services/hapticsService.ts';

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
  const downloads = useDownloads();
  const canDownload = downloadsSupported();
  const [seasonPickerOpen, setSeasonPickerOpen] = useState(false);
  // The one episode tile whose full description is open (accordion).
  const [expandedEp, setExpandedEp] = useState<number | null>(null);

  useEffect(() => subscribeLibraryChanges(() => {
    setSaved(isBookmarked(media.id, media.mediaType));
    setHistory(findHistory(media));
  }), [media]);

  // Resume on the season the viewer was last in.
  useEffect(() => {
    if (history?.season) setSeason(history.season);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background stream prefetching for instant playback
  useEffect(() => {
    prefetchStream({
      id: media.id,
      type: media.mediaType,
      season: history?.season ?? season,
      episode: history?.episode ?? 1,
      title: media.title,
      language: media.language
    });
  }, [media.id, media.mediaType, media.title, media.language, season, history?.season, history?.episode]);

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
  const seasonLabel = (n: number) => seasons.find(x => x.seasonNumber === n)?.name || `Season ${n}`;
  const seasonSections: CategorySection[] = [{ items: seasons.map(x => ({ key: String(x.seasonNumber), name: x.name || `Season ${x.seasonNumber}` })) }];

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
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(9,9,15,0.55) 0%, rgba(9,9,15,0.82) 70%, var(--bg-main) 100%)' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 'calc(var(--safe-top) + 12px) 20px 0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 20 }}>
          <button
            onClick={() => { hapticLight(); onBack(); }}
            className="interactive glass-pill-dark"
            aria-label="Back"
            style={{ width: '42px', height: '42px', borderRadius: 'var(--radius-pill)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.45)' }}
          >
            <ArrowLeft size={20} />
          </button>

          <div style={{ display: 'flex', gap: '10px' }}>
            {trailer && (
              <button
                onClick={() => { hapticLight(); setTrailerOpen(true); }}
                className="interactive glass-pill-dark"
                aria-label="Watch trailer"
                style={{ width: '42px', height: '42px', borderRadius: 'var(--radius-pill)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.45)' }}
              >
                <Clapperboard size={20} />
              </button>
            )}
            <button
              onClick={() => { if (!saved) hapticSuccess(); else hapticLight(); toggleBookmark(media); }}
              className="interactive glass-pill-dark"
              aria-label={saved ? 'In My List' : 'Add to My List'}
              style={{
                width: '42px', height: '42px', borderRadius: 'var(--radius-pill)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: saved ? '0 4px 16px rgba(229, 9, 20, 0.45)' : '0 4px 14px rgba(0,0,0,0.45)',
                background: saved ? 'linear-gradient(135deg, #ff3b45 0%, #e50914 100%)' : undefined,
                color: saved ? '#ffffff' : 'var(--text-primary)'
              }}
            >
              {saved ? <Check size={20} /> : <Plus size={20} />}
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 20px', marginTop: '-74px', position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '16px' }}>
          <div id="detail-poster-target" style={{ flexShrink: 0 }}>
            <FadeImage
              src={shown.poster}
              alt={shown.title}
              style={{ width: '108px', height: '154px', objectFit: 'cover', borderRadius: 'var(--radius-md)', boxShadow: 'var(--card-shadow-hover)', border: '1px solid rgba(255, 255, 255, 0.16)', display: 'block' }}
            />
          </div>
          <div style={{ flex: 1, paddingBottom: '4px', minWidth: 0 }}>
            <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: '1.25', letterSpacing: '-0.3px' }}>{shown.title}</h1>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px', fontWeight: 600 }}>
              {metaParts.join('  •  ')}
            </div>
          </div>
        </div>

        <button
          onClick={() => { hapticMedium(); handlePlay(); }}
          className="interactive"
          style={{ width: '100%', padding: '13px', borderRadius: 'var(--radius-md)', background: '#ffffff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#000000', fontSize: '15px', fontWeight: 800, marginBottom: '12px', boxShadow: '0 8px 24px rgba(255, 255, 255, 0.18)' }}
        >
          <Play size={20} fill="#000" />
          <span>{playLabel}</span>
        </button>

        {canDownload && !isSeries && (() => {
          const rec = downloads.find(d => d.id === downloadId('movie', media.id));
          const done = rec?.state === 'completed';
          const failed = rec?.state === 'failed';
          const active = !!rec && !done && !failed;
          const label = !rec ? 'Download' : done ? 'Downloaded - tap to delete' : failed ? 'Download failed - tap to retry' : rec.state === 'stopped' ? `Paused at ${Math.round(rec.percent)}%` : `Downloading ${Math.round(rec.percent)}% - tap to cancel`;
          return (
            <button
              onClick={() => {
                hapticSelection();
                if (!rec || failed) startDownload(media).catch(err => console.warn('[downloads] start failed:', err));
                else void removeDownload(rec.id);
              }}
              className="interactive glass-panel"
              style={{ position: 'relative', width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, marginBottom: '12px', border: 'none', overflow: 'hidden' }}
            >
              {done ? <Check size={18} /> : failed ? <RotateCw size={17} /> : <Download size={18} />}
              <span>{label}</span>
              {active && rec && (
                <span style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${Math.round(rec.percent)}%`, background: 'var(--accent-primary)', transition: 'width 0.4s linear' }} />
              )}
            </button>
          );
        })()}

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
            onClick={() => { hapticLight(); setExpanded(e => !e); }}
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

        <div className="seg-track" style={{ marginBottom: '18px' }}>
          {tabs.map(t => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { hapticLight(); setTab(t.id); }}
                className={`interactive seg-pill ${active ? 'active' : ''}`}
                style={{ padding: '8px 14px', fontSize: '13px' }}
              >
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {activeTab === 'episodes' && (
          <>
            {seasons.length > 1 && (
              <>
                <button
                  onClick={() => { hapticLight(); setSeasonPickerOpen(true); }}
                  className="interactive"
                  aria-haspopup="dialog"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', padding: '10px 14px', marginBottom: '14px', background: 'var(--track-bg)', border: '1px solid var(--border-subtle)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '15px', fontWeight: 700 }}
                >
                  <span>{seasonLabel(season)}</span>
                  <ChevronDown size={18} />
                </button>
                <CategoryPicker
                  open={seasonPickerOpen}
                  sections={seasonSections}
                  selectedKey={String(season)}
                  onSelect={key => { hapticSelection(); setSeasonPickerOpen(false); setExpandedEp(null); setSeason(Number(key)); }}
                  onClose={() => { hapticLight(); setSeasonPickerOpen(false); }}
                />
              </>
            )}

            {episodesError && !loadingEpisodes ? (
              <ErrorState compact message="Couldn't load the episode list." onRetry={() => setAttempt(n => n + 1)} />
            ) : loadingEpisodes ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: '10px', color: 'var(--text-secondary)' }}>
                <Loader2 size={24} className="animate-spin" />
                <span style={{ fontSize: '14px' }}>Fetching episodes...</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {episodes.map(ep => {
                  const current = history?.season === ep.seasonNumber && history.episode === ep.episodeNumber;
                  const expanded = expandedEp === ep.id;
                  const play = () => { hapticMedium(); onPlay(media, ep.seasonNumber, ep.episodeNumber, episodes); };
                  const status = current ? 'Last watched' : ep.runtime ? `${ep.runtime} min` : null;
                  return (
                    <div
                      key={ep.id}
                      role="button"
                      tabIndex={0}
                      aria-expanded={expanded}
                      // Tapping the tile opens (or closes) its description; opening
                      // another one closes this one. Only the thumbnail plays.
                      onClick={() => { hapticSelection(); setExpandedEp(expanded ? null : ep.id); }}
                      onKeyDown={e => {
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          setExpandedEp(expanded ? null : ep.id);
                        }
                      }}
                      className="interactive glass-panel"
                      aria-label={`Episode ${ep.episodeNumber}, ${ep.name}`}
                      style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', gap: '14px', padding: '12px', alignItems: expanded ? 'flex-start' : 'center' }}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`Play episode ${ep.episodeNumber}`}
                        onClick={e => { e.stopPropagation(); play(); }}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); play(); } }}
                        style={{ position: 'relative', width: '124px', height: '70px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', flexShrink: 0, background: 'var(--track-bg)', cursor: 'pointer' }}
                      >
                        {ep.still && <FadeImage src={ep.still} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Play size={14} fill="#fff" color="#fff" style={{ marginLeft: '1px' }} />
                          </div>
                        </div>
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 style={{
                          fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.2px',
                          ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' })
                        }}>
                          {ep.episodeNumber}. {ep.name}
                        </h3>
                        {status && (
                          <p style={{ fontSize: '12px', color: current ? 'var(--accent-primary)' : 'var(--text-muted)', marginTop: '3px', fontWeight: 600 }}>{status}</p>
                        )}
                        {(ep.overview || expanded) && (
                          <p style={{
                            fontSize: '12px', lineHeight: 1.45, color: 'var(--text-secondary)', marginTop: '4px',
                            ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' })
                          }}>
                            {ep.overview || 'No description available for this episode.'}
                          </p>
                        )}
                      </div>

                      {canDownload && (
                        <DownloadButton
                          record={downloads.find(d => d.id === downloadId('tv', media.id, ep.seasonNumber, ep.episodeNumber))}
                          onStart={() => { hapticSelection(); startDownload(media, ep.seasonNumber, ep.episodeNumber, ep.name).catch(err => console.warn('[downloads] start failed:', err)); }}
                          onRemove={() => { hapticLight(); void removeDownload(downloadId('tv', media.id, ep.seasonNumber, ep.episodeNumber)); }}
                        />
                      )}
                    </div>
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
                <div key={i} className="skeleton" style={{ borderRadius: 'var(--radius-md)', paddingTop: '145%' }} />
              ))}
            </div>
          ) : similar.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-secondary)', fontSize: '13px' }}>No suggestions found for this title.</p>
          ) : (
            <div className="grid-collection">
              {similar.map(item => (
                <PosterCard key={`${item.mediaType}-${item.id}`} media={item} onSelect={onSelectMedia} />
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
