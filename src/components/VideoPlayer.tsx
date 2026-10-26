// VideoPlayer.tsx - Background stream resolution engine with dual ExoPlayer/WebPlayer and iframe embed handling
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import type { MediaItem, EpisodeItem } from '../core/cineHypeCore.ts';
import { resolveStream, type ResolvedStream } from '../services/streamResolver.ts';
import { saveWatchProgress } from '../services/historyService.ts';
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
  const [frameReady, setFrameReady] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState<number>(0);

  const currentEpisodeData = episodeList.find(e => e.episodeNumber === episode);
  const hasNextEpisode = isSeries && episodeList.some(e => e.episodeNumber === episode + 1);

  const episodes = useMemo(
    () => (isSeries ? episodeList.filter(e => e.seasonNumber === season) : []),
    [isSeries, episodeList, season]
  );

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

  // Native ExoPlayer event listeners (playerClosed, progressUpdate, episode navigation)
  useEffect(() => {
    if (!isNative) return;
    let handles: PluginListenerHandle[] = [];

    const setupListeners = async () => {
      try {
        const h1 = await ExoPlayerPlugin.addListener('playerClosed', () => {
          onBack();
        });
        const h2 = await ExoPlayerPlugin.addListener('progressUpdate', (e) => {
          if (e.positionMs > 0 && e.durationMs > 0) {
            saveProgress(e.positionMs, e.durationMs);
          }
        });
        const h3 = await ExoPlayerPlugin.addListener('episodeSelected', (e) => {
          const selectedNum = parseInt(e.selectedNumber || e.episode, 10);
          if (!isNaN(selectedNum)) {
            const target = episodeList.find(ep => ep.episodeNumber === selectedNum);
            if (target && onSelectEpisode) onSelectEpisode(target);
          }
        });
        const h4 = await ExoPlayerPlugin.addListener('nextEpisodeStarted', (e) => {
          const currentNum = parseInt(e.episode, 10);
          if (!isNaN(currentNum)) {
            const nextTarget = episodeList.find(ep => ep.episodeNumber === currentNum);
            if (nextTarget && onSelectEpisode) onSelectEpisode(nextTarget);
          }
        });
        handles = [h1, h2, h3, h4];
      } catch (err) {
        console.warn('[VideoPlayer] Error setting up ExoPlayer listeners:', err);
      }
    };

    setupListeners();

    return () => {
      handles.forEach(h => h.remove());
    };
  }, [isNative, onBack, saveProgress, episodeList, onSelectEpisode]);

  // Background stream resolution
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setFrameReady(false);

    resolveStream(
      { id: media.id, type: media.mediaType, season, episode },
      { fresh: attempt > 0 }
    )
      .then(res => {
        if (!active) return;
        setSource(res);
        setLoading(false);

        // On native Android, ALWAYS launch native Media3 Netflix ExoPlayer (ExoPlayerActivity sniffs direct .m3u8 if embed URL is passed)
        if (isNative && res && res.url) {
          openNativeExoPlayer({
            url: res.url,
            title: media.title,
            episode: isSeries ? String(episode) : '1',
            seasonPrefix: isSeries ? `S${season}:` : '',
            referer: res.headers?.Referer || res.headers?.referer || '',
            headers: res.headers,
            subtitles: (res.subtitles || []).map((t, i) => ({
              src: t.url,
              label: t.label || t.lang || 'Subtitle',
              default: i === 0
            })),
            episodes: isSeries ? episodes.map(e => ({ id: String(e.id), number: String(e.episodeNumber) })) : undefined,
            isFallback: res.isFallbackEmbed ?? false,
            autoPlayNext: hasNextEpisode
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
  }, [media.id, media.mediaType, season, episode, attempt, isSeries, media.title, episodes, hasNextEpisode]);

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
          <button onClick={onBack} className="interactive netflix-icon-btn" aria-label="Back">
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

        <button onClick={() => setReloadKey(k => k + 1)} className="interactive netflix-icon-btn" title="Reload Stream">
          <RefreshCw size={20} color="#fff" />
        </button>
      </div>

      {/* Frame Container */}
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <iframe
          key={`${source.url}-${reloadKey}`}
          src={source.url}
          title={`${media.title} Stream`}
          style={{ width: '100%', height: '100%', border: 'none', background: '#000000' }}
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
