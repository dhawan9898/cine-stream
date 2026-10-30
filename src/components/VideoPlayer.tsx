// VideoPlayer.tsx - Background stream resolution engine with dual ExoPlayer/WebPlayer and iframe embed handling
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { getTVSeasonEpisodes, type MediaItem, type EpisodeItem } from '../core/cineHypeCore.ts';
import { resolveStream, type ResolvedStream } from '../services/streamResolver.ts';
import { getResumePositionMs, getUserPreferences, saveWatchProgress } from '../services/historyService.ts';
import { openNativeExoPlayer } from '../services/nativePlayer.ts';
import { ExoPlayerPlugin } from '../plugins/exoPlayerPlugin.ts';
import { WebPlayer, type StreamSource, type EpisodeItem as PlayerEpisode } from './WebPlayer.tsx';

interface VideoPlayerProps {
  media: MediaItem;
  season?: number;
  episode?: number;
  episodeList?: EpisodeItem[];
  onBack: () => void;
  onSelectEpisode?: (ep: EpisodeItem) => void;
}

const isNative = Capacitor.isNativePlatform();

function isDirectVideoUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('blob:') || url.startsWith('file:')) return true;
  const lower = url.toLowerCase();
  const path = lower.split('?')[0];
  return (
    /\.(m3u8|mpd|mp4|webm|mkv)($|\?)/.test(path) ||
    /\.(m3u8|mpd|mp4|webm|mkv)/.test(lower)
  );
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  media,
  season = 1,
  episode = 1,
  episodeList = [],
  onBack,
  onSelectEpisode
}) => {
  const isSeries = media.mediaType === 'tv';
  const [source, setSource] = useState<ResolvedStream | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const [langMode, setLangMode] = useState<string>('sub');
  const [frameReady, setFrameReady] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [fetchedEpisodes, setFetchedEpisodes] = useState<EpisodeItem[]>([]);

  // Holds the resume position requested by ExoPlayerActivity when an HTTP error triggers a fresh reload
  const reloadResumeMsRef = useRef<number | null>(null);
  // Tracks when ExoPlayerActivity already started a prefetched next episode on its own
  const nativePrefetchStartedEpRef = useRef<number | null>(null);

  // Ensure episode list is available even when playback starts directly from Home or Library
  useEffect(() => {
    if (!isSeries) return;
    const hasSeasonEpisodes = episodeList.some(e => e.seasonNumber === season);
    if (hasSeasonEpisodes) return;

    let cancelled = false;
    getTVSeasonEpisodes(media.id, season)
      .then(eps => {
        if (!cancelled) setFetchedEpisodes(eps);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isSeries, media.id, season, episodeList]);

  const episodes = useMemo(() => {
    if (!isSeries) return [];
    const fromProp = episodeList.filter(e => e.seasonNumber === season);
    if (fromProp.length > 0) return fromProp;
    return fetchedEpisodes.filter(e => e.seasonNumber === season);
  }, [isSeries, episodeList, fetchedEpisodes, season]);

  const currentEpisodeData = episodes.find(e => e.episodeNumber === episode);
  const hasNextEpisode = isSeries && episodes.some(e => e.episodeNumber === episode + 1);

  const initialPositionMs = useMemo(
    () => getResumePositionMs(media.id, media.mediaType, season, episode),
    [media.id, media.mediaType, season, episode]
  );

  // Track watch progress
  const saveProgress = useCallback((positionMs: number, durationMs: number, epOverride?: number) => {
    if (durationMs <= 0) return;
    const activeEp = epOverride ?? episode;
    const epData = episodes.find(e => e.episodeNumber === activeEp);
    saveWatchProgress({
      media,
      season: isSeries ? season : undefined,
      episode: isSeries ? activeEp : undefined,
      episodeName: epData?.name,
      progressPercent: (positionMs / durationMs) * 100,
      positionMs,
      durationMs
    });
  }, [media, season, episode, isSeries, episodes]);

  const resolveEpisodeTarget = useCallback((epNum: number): EpisodeItem => {
    const found = episodes.find(ep => ep.episodeNumber === epNum);
    if (found) return found;
    return {
      id: epNum,
      episodeNumber: epNum,
      seasonNumber: season,
      name: `Episode ${epNum}`,
      overview: '',
      still: ''
    };
  }, [episodes, season]);

  // Native ExoPlayer event listeners (playerClosed, progressUpdate, episode navigation, reloadRequested)
  useEffect(() => {
    if (!isNative) return;
    let disposed = false;
    let handles: PluginListenerHandle[] = [];

    const setupListeners = async () => {
      try {
        const h1 = await ExoPlayerPlugin.addListener('playerClosed', () => {
          onBack();
        });
        const h2 = await ExoPlayerPlugin.addListener('progressUpdate', (e) => {
          if (e.positionMs > 0 && e.durationMs > 0) {
            const reportedEp = isSeries ? parseInt(e.episode, 10) : undefined;
            saveProgress(
              e.positionMs,
              e.durationMs,
              reportedEp && !isNaN(reportedEp) ? reportedEp : undefined
            );
          }
        });
        const h3 = await ExoPlayerPlugin.addListener('episodeSelected', (e) => {
          const selectedNum = parseInt(e.selectedNumber || e.episode, 10);
          if (!isNaN(selectedNum) && onSelectEpisode) {
            onSelectEpisode(resolveEpisodeTarget(selectedNum));
          }
        });
        const h4 = await ExoPlayerPlugin.addListener('nextEpisodeRequested', (e) => {
          const prevNum = parseInt(e.episode, 10);
          const nextNum = !isNaN(prevNum) ? prevNum + 1 : episode + 1;
          if (onSelectEpisode) {
            onSelectEpisode(resolveEpisodeTarget(nextNum));
          }
        });
        const h5 = await ExoPlayerPlugin.addListener('nextEpisodeStarted', (e) => {
          const startedNum = parseInt(e.episode, 10);
          if (!isNaN(startedNum) && onSelectEpisode) {
            nativePrefetchStartedEpRef.current = startedNum;
            onSelectEpisode(resolveEpisodeTarget(startedNum));
          }
        });
        const h6 = await ExoPlayerPlugin.addListener('reloadRequested', (e) => {
          reloadResumeMsRef.current = e.positionMs > 0 ? e.positionMs : null;
          setAttempt(n => n + 1);
        });
        if (disposed) {
          [h1, h2, h3, h4, h5, h6].forEach(h => h.remove());
          return;
        }
        handles = [h1, h2, h3, h4, h5, h6];
      } catch (err) {
        console.warn('[VideoPlayer] Error setting up ExoPlayer listeners:', err);
      }
    };

    setupListeners();

    return () => {
      disposed = true;
      handles.forEach(h => h.remove());
    };
  }, [onBack, saveProgress, episode, isSeries, onSelectEpisode, resolveEpisodeTarget]);

  // Helper to prefetch the next episode for Native ExoPlayer
  const prefetchNativeNextEpisode = useCallback((currentEp: number) => {
    if (!isNative || !isSeries) return;
    const nextEpNum = currentEp + 1;
    if (!episodes.some(e => e.episodeNumber === nextEpNum)) return;

    resolveStream({ id: media.id, type: media.mediaType, season, episode: nextEpNum })
      .then(nextRes => {
        if (!nextRes?.url) return;
        const prefs = getUserPreferences();
        ExoPlayerPlugin.setNextEpisode({
          afterEpisode: String(currentEp),
          url: nextRes.url,
          title: media.title,
          episode: String(nextEpNum),
          seasonPrefix: `S${season}:`,
          referer: nextRes.headers?.Referer || nextRes.headers?.referer || '',
          headers: nextRes.headers,
          subtitles: (nextRes.subtitles || []).map((t, i) => ({
            src: t.url,
            label: t.label || t.lang || 'Subtitle',
            default: i === 0
          })),
          isFallback: nextRes.isFallbackEmbed ?? false,
          autoPlayNext: prefs.autoplayNext
        }).catch(() => {});
      })
      .catch(() => {});
  }, [isSeries, episodes, media.id, media.mediaType, media.title, season]);

  // Background stream resolution
  useEffect(() => {
    let active = true;

    // If ExoPlayerActivity already transitioned to this episode via a prefetched intent,
    // don't re-trigger play(); just prefetch the episode after it.
    if (isNative && nativePrefetchStartedEpRef.current === episode) {
      nativePrefetchStartedEpRef.current = null;
      prefetchNativeNextEpisode(episode);
      return;
    }

    setLoading(true);
    setError(null);
    setFrameReady(false);

    const startPositionMs = reloadResumeMsRef.current ?? initialPositionMs;
    reloadResumeMsRef.current = null;

    resolveStream(
      { id: media.id, type: media.mediaType, season, episode, languageMode: langMode, title: media.title },
      { fresh: attempt > 0 }
    )
      .then(res => {
        if (!active) return;

        // Telegram in-memory Blob URLs cannot be directly read by Android ExoPlayer
        if (isNative && res?.url?.startsWith('blob:')) {
          setLoading(false);
          setError('Telegram in-memory streams cannot be opened directly in native ExoPlayer.');
          return;
        }

        setSource(res);
        setLoading(false);

        // On native Android, launch native Media3 Netflix ExoPlayer
        if (isNative && res && res.url) {
          const prefs = getUserPreferences();
          openNativeExoPlayer({
            url: res.url,
            title: media.title,
            episode: isSeries ? String(episode) : '1',
            seasonPrefix: isSeries ? `S${season}:` : '',
            referer: res.headers?.Referer || res.headers?.referer || '',
            headers: res.headers,
            mode: langMode,
            subtitles: (res.subtitles || []).map((t, i) => ({
              src: t.url,
              label: t.label || t.lang || 'Subtitle',
              default: i === 0
            })),
            episodes: isSeries ? episodes.map(e => ({ id: String(e.id), number: String(e.episodeNumber) })) : undefined,
            startPositionMs: startPositionMs > 0 ? startPositionMs : undefined,
            isFallback: res.isFallbackEmbed ?? false,
            autoPlayNext: prefs.autoplayNext && hasNextEpisode
          });
          if (hasNextEpisode) {
            prefetchNativeNextEpisode(episode);
          }
        }
      })
      .catch(err => {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Failed to resolve streaming data.';
        setLoading(false);
        setError(message);
        if (isNative) {
          ExoPlayerPlugin.fail({ message }).catch(() => {});
        }
      });

    return () => {
      active = false;
    };
  }, [
    media.id,
    media.mediaType,
    season,
    episode,
    attempt,
    isSeries,
    media.title,
    episodes,
    hasNextEpisode,
    initialPositionMs,
    prefetchNativeNextEpisode,
    langMode
  ]);

  const handleNextEpisode = () => {
    if (!hasNextEpisode || !onSelectEpisode) return;
    const nextEp = episodes.find(e => e.episodeNumber === episode + 1);
    if (nextEp) onSelectEpisode(nextEp);
  };

  const webSource = useMemo<StreamSource | null>(() => {
    if (!source || !isDirectVideoUrl(source.url)) return null;
    return {
      streamUrl: source.url,
      quality: source.quality ?? '1080p',
      referer: source.headers?.Referer ?? '',
      headers: source.headers,
      subtitles: (source.subtitles ?? []).map((t, i) => ({
        src: t.url,
        label: t.label || t.lang,
        default: i === 0
      }))
    };
  }, [source]);

  const webEpisodes = useMemo<PlayerEpisode[]>(
    () => episodes.map(e => ({ id: String(e.id), number: String(e.episodeNumber), title: e.name })),
    [episodes]
  );
  const currentWebEpisode = webEpisodes.find(e => e.number === String(episode));

  // Error View
  if (error) {
    return (
      <div className="player-state" role="alert" style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', gap: '16px' }}>
        <button onClick={onBack} className="interactive nf-icon-btn" aria-label="Back" style={{ position: 'absolute', top: 'calc(16px + var(--safe-top))', left: '16px' }}>
          <ArrowLeft size={28} color="#fff" />
        </button>
        <h3 style={{ fontSize: '20px', fontWeight: 800 }}>Playback Error</h3>
        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', textAlign: 'center', maxWidth: '400px' }}>{error}</p>
        <button className="interactive btn-primary" onClick={() => setAttempt(n => n + 1)} style={{ padding: '10px 24px' }}>
          Try Again
        </button>
      </div>
    );
  }

  // Loading View
  if (loading || !source) {
    return (
      <div className="player-state" aria-busy="true" style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', gap: '16px' }}>
        <button onClick={onBack} className="interactive nf-icon-btn" aria-label="Back" style={{ position: 'absolute', top: 'calc(16px + var(--safe-top))', left: '16px' }}>
          <ArrowLeft size={28} color="#fff" />
        </button>
        <Loader2 size={48} color="var(--accent-primary)" className="animate-spin" />
        <p style={{ fontSize: '15px', fontWeight: 700 }}>
          {media.title}{isSeries ? ` · Season ${season} Episode ${episode}` : ''}
        </p>
        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Fetching video stream...</span>
      </div>
    );
  }

  // Native Android Platform Mode (ExoPlayerActivity runs full screen above this view)
  if (isNative) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', gap: '12px' }}>
        <Loader2 size={44} color="var(--accent-primary)" className="animate-spin" />
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>Launching Netflix ExoPlayer...</span>
      </div>
    );
  }

  // Direct HLS / MP4 Media Stream Mode for Web
  if (isDirectVideoUrl(source.url) && webSource) {
    return (
      <WebPlayer
        streamSource={webSource}
        title={media.title}
        episode={isSeries ? currentWebEpisode ?? { id: String(episode), number: String(episode) } : undefined}
        episodeList={isSeries ? webEpisodes : undefined}
        initialTime={initialPositionMs > 0 ? initialPositionMs / 1000 : 0}
        onBack={onBack}
        hasNextEpisode={hasNextEpisode}
        onNextEpisode={handleNextEpisode}
        onSelectEpisode={ep => {
          const target = episodes.find(e => String(e.episodeNumber) === ep.number);
          if (target) onSelectEpisode?.(target);
        }}
        onProgressUpdate={(time, dur) => saveProgress(time * 1000, dur * 1000)}
      />
    );
  }

  // Embed Iframe Mode (Web Fallback)
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#000', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      {/* Top Controls Overlay */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          padding: 'calc(12px + var(--safe-top)) 20px 16px 20px',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 70%, transparent 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pointerEvents: 'auto'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={onBack} className="interactive nf-icon-btn" aria-label="Back">
            <ArrowLeft size={24} color="#fff" />
          </button>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#fff' }}>{media.title}</div>
            {isSeries && (
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
                S{season}:E{episode}{currentEpisodeData?.name ? ` “${currentEpisodeData.name}”` : ''}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            value={langMode}
            onChange={e => setLangMode(e.target.value)}
            className="interactive"
            style={{
              padding: '6px 12px',
              borderRadius: '20px',
              color: '#fff',
              background: 'rgba(0,0,0,0.65)',
              border: '1px solid rgba(255,255,255,0.25)',
              fontSize: '12px',
              fontWeight: 700,
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="sub">Sub / Orig</option>
            <option value="dub">Dubbed</option>
            <option value="hindi">Hindi Dub</option>
            <option value="telugu">Telugu Dub</option>
            <option value="tamil">Tamil Dub</option>
          </select>
          <button onClick={() => setReloadKey(k => k + 1)} className="interactive nf-icon-btn" title="Reload Stream">
            <RefreshCw size={20} color="#fff" />
          </button>
        </div>
      </div>

      {/* Frame Container */}
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <iframe
          key={`${source.url}-${reloadKey}`}
          src={source.url}
          title={`${media.title} Stream`}
          style={{ width: '100%', height: '100%', border: 'none', background: '#000000' }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
          onLoad={() => setFrameReady(true)}
        />

        {!frameReady && (
          <div style={{ position: 'absolute', inset: 0, background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', zIndex: 10 }}>
            <Loader2 size={44} color="var(--accent-primary)" className="animate-spin" />
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>Loading video frame...</span>
          </div>
        )}
      </div>
    </div>
  );
};
