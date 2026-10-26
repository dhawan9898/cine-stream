// VideoPlayer.tsx - Direct stream playback using ExoPlayer / WebPlayer with background auto-resolution
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import type { MediaItem, EpisodeItem } from '../core/cineHypeCore.ts';
import { resolveStream, type ResolvedStream } from '../services/streamResolver.ts';
import { saveWatchProgress, getUserPreferences } from '../services/historyService.ts';
import { ExoPlayerPlugin, type PlayOptions } from '../plugins/exoPlayerPlugin.ts';
import { openNativeExoPlayer } from '../services/nativePlayer.ts';
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
  const [attempt, setAttempt] = useState(0);

  const currentEpisodeData = episodeList.find(e => e.episodeNumber === episode);
  const hasNextEpisode = isSeries && episodeList.some(e => e.episodeNumber === episode + 1);

  const episodes = useMemo(
    () => (isSeries ? episodeList.filter(e => e.seasonNumber === season) : []),
    [isSeries, episodeList, season]
  );

  // Background stream resolution
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    resolveStream(
      { id: media.id, type: media.mediaType, season, episode },
      { fresh: attempt > 0 }
    )
      .then(res => {
        if (!active) return;
        setSource(res);
        setLoading(false);

        // On Android native, automatically open Jetpack Media3 ExoPlayer with direct stream
        if (isNative && res && res.url) {
          openNativeExoPlayer({
            videoUrl: res.url,
            title: `${media.title}${isSeries ? ` S${season}:E${episode}` : ''}`,
            headers: res.headers
          });
        }
      })
      .catch(err => {
        if (!active) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Failed to resolve streaming data.');
      });

    return () => {
      active = false;
    };
  }, [media.id, media.mediaType, season, episode, attempt, isSeries, media.title]);

  // Track watch progress
  const saveProgress = useCallback((positionMs: number, durationMs: number) => {
    if (durationMs <= 0) return;
    saveWatchProgress({
      media,
      season: isSeries ? season : undefined,
      episode: isSeries ? episode : undefined,
      episodeName: currentEpisodeData?.name,
      progressPercent: (positionMs / durationMs) * 100
    });
  }, [media, season, episode, isSeries, currentEpisodeData]);

  const handleNextEpisode = () => {
    if (!hasNextEpisode || !onSelectEpisode) return;
    const nextEp = episodes.find(e => e.episodeNumber === episode + 1);
    if (nextEp) onSelectEpisode(nextEp);
  };

  const webSource = useMemo<StreamSource | null>(() => {
    if (!source) return null;
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
        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Fetching direct stream in background...</span>
      </div>
    );
  }

  // Native ExoPlayer view on Android
  if (isNative) {
    return <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 9999 }} />;
  }

  // Direct HLS Web Player view
  return (
    <WebPlayer
      streamSource={webSource!}
      title={media.title}
      episode={isSeries ? currentWebEpisode ?? { id: String(episode), number: String(episode) } : undefined}
      episodeList={isSeries ? webEpisodes : undefined}
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
};
