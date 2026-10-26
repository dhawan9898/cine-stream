// VideoPlayer.tsx - Playback engine supporting direct native HLS/ExoPlayer and iframe embeds
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  Server,
  List,
  SkipForward,
  RefreshCw,
  X,
  Check,
  Info,
  ExternalLink,
  Copy
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import type { MediaItem, EpisodeItem } from '../core/cineHypeCore.ts';
import {
  STREAM_SERVERS,
  resolveStream,
  type ResolvedStream,
  type StreamServer
} from '../services/streamResolver.ts';
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
  const prefs = getUserPreferences();
  const [selectedServer, setSelectedServer] = useState<string>(prefs.defaultServer || 'native');
  const [source, setSource] = useState<ResolvedStream | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Modals
  const [showServerModal, setShowServerModal] = useState<boolean>(false);
  const [showEpisodesDrawer, setShowEpisodesDrawer] = useState<boolean>(false);
  const [showInfoModal, setShowInfoModal] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [frameReady, setFrameReady] = useState<boolean>(false);
  const [iframeKey, setIframeKey] = useState<number>(0);

  const currentEpisodeData = episodeList.find(e => e.episodeNumber === episode);
  const hasNextEpisode = isSeries && episodeList.some(e => e.episodeNumber === episode + 1);

  const episodes = useMemo(
    () => (isSeries ? episodeList.filter(e => e.seasonNumber === season) : []),
    [isSeries, episodeList, season]
  );

  // Resolve stream source
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setFrameReady(false);

    resolveStream(
      { id: media.id, type: media.mediaType, season, episode, server: selectedServer },
      { fresh: attempt > 0 }
    )
      .then(res => {
        if (!active) return;
        setSource(res);
        setLoading(false);

        // If direct stream available on Android native, launch native ExoPlayer Activity
        if (isNative && !res.isFallbackEmbed) {
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
        setError(err instanceof Error ? err.message : 'Failed to load video stream.');
      });

    return () => {
      active = false;
    };
  }, [media.id, media.mediaType, season, episode, selectedServer, attempt, isSeries, media.title]);

  // Track progress
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
    if (nextEp) {
      onSelectEpisode(nextEp);
      setIframeKey(k => k + 1);
    }
  };

  const currentServerObj = STREAM_SERVERS.find(s => s.id === selectedServer) || STREAM_SERVERS[0];

  const webSource = useMemo<StreamSource | null>(() => {
    if (!source || source.isFallbackEmbed) return null;
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
        <h3 style={{ fontSize: '20px', fontWeight: 800 }}>Stream Resolution Issue</h3>
        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', textAlign: 'center', maxWidth: '400px' }}>{error}</p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="interactive btn-primary" onClick={() => setAttempt(n => n + 1)} style={{ padding: '10px 20px' }}>
            Try Again
          </button>
          <button className="interactive btn-secondary" onClick={() => setShowServerModal(true)} style={{ padding: '10px 20px' }}>
            <Server size={18} />
            Switch Server
          </button>
        </div>
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
        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Connecting to {currentServerObj.name}...</span>
      </div>
    );
  }

  // Direct HLS Stream Mode (WebPlayer)
  if (!source.isFallbackEmbed && webSource) {
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

  // Embed Fallback Mode
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#000',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Top Header HUD */}
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setShowServerModal(true)}
            className="interactive btn-secondary"
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            <Server size={14} />
            <span>{currentServerObj.name}</span>
          </button>

          {isSeries && episodes.length > 0 && (
            <button
              onClick={() => setShowEpisodesDrawer(true)}
              className="interactive netflix-icon-btn"
              title="Episodes"
            >
              <List size={20} />
            </button>
          )}

          {hasNextEpisode && (
            <button
              onClick={handleNextEpisode}
              className="interactive netflix-icon-btn"
              title="Next Episode"
            >
              <SkipForward size={20} />
            </button>
          )}

          <button
            onClick={() => setIframeKey(k => k + 1)}
            className="interactive netflix-icon-btn"
            title="Reload Frame"
          >
            <RefreshCw size={18} />
          </button>

          <button
            onClick={() => setShowInfoModal(true)}
            className="interactive netflix-icon-btn"
            title="Info"
          >
            <Info size={18} />
          </button>
        </div>
      </div>

      {/* Embedded Iframe Player */}
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <iframe
          key={`${selectedServer}-${season}-${episode}-${iframeKey}`}
          src={source.url}
          title={`${media.title} Embed`}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: '#000000'
          }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
          onLoad={() => setFrameReady(true)}
        />

        {!frameReady && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: '#000',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              zIndex: 10
            }}
          >
            <Loader2 size={44} color="var(--accent-primary)" className="animate-spin" />
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
              Connecting to {currentServerObj.name}...
            </span>
          </div>
        )}
      </div>

      {/* Server Switcher Modal */}
      {showServerModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 120,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(20px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowServerModal(false)}
        >
          <div
            className="liquid-glass"
            style={{
              width: '100%',
              maxWidth: '560px',
              borderRadius: 'var(--radius-xl)',
              padding: '28px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Server size={22} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#ffffff' }}>
                  Select Stream Provider
                </h3>
              </div>
              <button
                onClick={() => setShowServerModal(false)}
                className="interactive netflix-icon-btn"
                style={{ width: 36, height: 36 }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto' }}>
              {STREAM_SERVERS.map(srv => {
                const isSelected = srv.id === selectedServer;
                return (
                  <button
                    key={srv.id}
                    onClick={() => {
                      setSelectedServer(srv.id);
                      setShowServerModal(false);
                    }}
                    className="interactive"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-md)',
                      background: isSelected ? 'rgba(229, 9, 20, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                      border: isSelected ? '1px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.12)',
                      textAlign: 'left'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>{srv.name}</span>
                        <span className="badge" style={{ background: 'rgba(255, 255, 255, 0.12)', color: '#fff', fontSize: '10px' }}>{srv.badge}</span>
                        <span style={{ fontSize: '11px', color: 'var(--accent-gold)' }}>⚡ {srv.speed}</span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.65)' }}>{srv.description}</div>
                    </div>
                    {isSelected && <Check size={18} color="var(--accent-primary)" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Episodes Drawer */}
      {showEpisodesDrawer && (
        <div className="netflix-glass-drawer" style={{ zIndex: 120 }}>
          <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>Season {season} Episodes</h3>
            <button onClick={() => setShowEpisodesDrawer(false)} className="interactive netflix-icon-btn"><X size={20} /></button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {episodes.map(ep => {
              const isCurrent = ep.episodeNumber === episode;
              return (
                <div
                  key={ep.id}
                  onClick={() => {
                    if (onSelectEpisode) onSelectEpisode(ep);
                    setShowEpisodesDrawer(false);
                  }}
                  className="interactive"
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: isCurrent ? 'rgba(229, 9, 20, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                    border: isCurrent ? '1px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ fontSize: '14px', fontWeight: 800, color: isCurrent ? 'var(--accent-primary)' : '#fff' }}>{ep.episodeNumber}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ep.name}</div>
                  </div>
                  {isCurrent && <Check size={16} color="var(--accent-primary)" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stream Info Modal */}
      {showInfoModal && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 130, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={() => setShowInfoModal(false)}
        >
          <div className="liquid-glass" style={{ width: '100%', maxWidth: '500px', padding: '24px', borderRadius: '16px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>Stream Details</h3>
              <button onClick={() => setShowInfoModal(false)} className="interactive netflix-icon-btn"><X size={18} /></button>
            </div>
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div><strong>Provider:</strong> {currentServerObj.name} ({currentServerObj.badge})</div>
              <div><strong>Source URL:</strong></div>
              <div style={{ background: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '6px', fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all', color: '#38bdf8' }}>{source.url}</div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(source.url);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="btn-secondary interactive"
                  style={{ flex: 1, padding: '8px', fontSize: '12px' }}
                >
                  {copiedLink ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
                  <span>{copiedLink ? 'Copied!' : 'Copy Stream Link'}</span>
                </button>
                <a href={source.url} target="_blank" rel="noopener noreferrer" className="btn-primary interactive" style={{ flex: 1, padding: '8px', fontSize: '12px', textDecoration: 'none' }}>
                  <ExternalLink size={14} />
                  <span>Open in Tab</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
