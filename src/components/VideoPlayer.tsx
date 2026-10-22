// VideoPlayer.tsx - CineHype Streaming Player Engine with Multi-Server Switcher
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Server,
  RefreshCw,
  Maximize,
  Minimize,
  SkipForward,
  List,
  ExternalLink,
  ShieldAlert,
  Check,
  X,
  Play
} from 'lucide-react';
import type { MediaItem, EpisodeItem } from '../core/cineHypeCore.ts';
import { STREAM_SERVERS, resolveStreamUrl, type StreamServer } from '../services/streamResolver.ts';
import { saveWatchProgress, getUserPreferences } from '../services/historyService.ts';

interface VideoPlayerProps {
  media: MediaItem;
  season?: number;
  episode?: number;
  episodeList?: EpisodeItem[];
  onBack: () => void;
  onSelectEpisode?: (ep: EpisodeItem) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  media,
  season = 1,
  episode = 1,
  episodeList = [],
  onBack,
  onSelectEpisode
}) => {
  const prefs = getUserPreferences();
  const [selectedServer, setSelectedServer] = useState<string>(prefs.defaultServer || 'vidfast');
  const [showServerModal, setShowServerModal] = useState(false);
  const [showEpisodesDrawer, setShowEpisodesDrawer] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const isSeries = media.mediaType === 'tv';
  const currentEpisodeData = episodeList.find(e => e.episodeNumber === episode);
  const hasNextEpisode = isSeries && episodeList.some(e => e.episodeNumber === episode + 1);

  // Compute stream URL
  const streamUrl = resolveStreamUrl({
    id: media.id,
    type: media.mediaType,
    season,
    episode,
    server: selectedServer
  });

  // Track watch progress
  useEffect(() => {
    saveWatchProgress({
      media,
      season: isSeries ? season : undefined,
      episode: isSeries ? episode : undefined,
      episodeName: currentEpisodeData?.name,
      progressPercent: 20 // Active watch marker
    });

    const interval = setInterval(() => {
      saveWatchProgress({
        media,
        season: isSeries ? season : undefined,
        episode: isSeries ? episode : undefined,
        episodeName: currentEpisodeData?.name,
        progressPercent: 50
      });
    }, 15000);

    return () => clearInterval(interval);
  }, [media, season, episode, isSeries, currentEpisodeData]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleNextEpisode = () => {
    if (!hasNextEpisode || !onSelectEpisode) return;
    const nextEp = episodeList.find(e => e.episodeNumber === episode + 1);
    if (nextEp) {
      onSelectEpisode(nextEp);
      setIframeKey(prev => prev + 1);
    }
  };

  const currentServerObj = STREAM_SERVERS.find(s => s.id === selectedServer) || STREAM_SERVERS[0];

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#000000',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Top Player Control Header */}
      <div
        style={{
          height: '60px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 70%, transparent 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 10,
          color: '#ffffff'
        }}
      >
        {/* Back and Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', maxWidth: '60%' }}>
          <button
            onClick={onBack}
            className="interactive"
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>

          <div style={{ overflow: 'hidden' }}>
            <h2
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: '#ffffff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {media.title}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>
              {isSeries && (
                <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>
                  S{season} E{episode} {currentEpisodeData?.name ? `• ${currentEpisodeData.name}` : ''}
                </span>
              )}
              <span>• {currentServerObj.name}</span>
            </div>
          </div>
        </div>

        {/* Right Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Server Switcher Button */}
          <button
            onClick={() => setShowServerModal(true)}
            className="interactive"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(236, 28, 36, 0.25)',
              border: '1px solid rgba(236, 28, 36, 0.5)',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 700,
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)'
            }}
          >
            <Server size={14} color="var(--accent-primary)" />
            <span>Server: {currentServerObj.name}</span>
          </button>

          {/* Episode Drawer Button (for TV) */}
          {isSeries && episodeList.length > 0 && (
            <button
              onClick={() => setShowEpisodesDrawer(!showEpisodesDrawer)}
              className="interactive"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.12)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 600,
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              <List size={14} />
              <span>Episodes</span>
            </button>
          )}

          {/* Next Episode Button */}
          {hasNextEpisode && (
            <button
              onClick={handleNextEpisode}
              className="interactive btn-primary"
              style={{
                fontSize: '12px',
                fontWeight: 700,
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                gap: '4px'
              }}
            >
              <span>Next</span>
              <SkipForward size={14} />
            </button>
          )}

          {/* Refresh stream */}
          <button
            onClick={() => setIframeKey(k => k + 1)}
            className="interactive"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Reload Stream"
            aria-label="Reload Stream"
          >
            <RefreshCw size={16} />
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="interactive"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            aria-label="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>

      {/* Main Stream Iframe Area */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          width: '100%',
          height: '100%',
          background: '#000000'
        }}
      >
        <iframe
          key={`${selectedServer}-${season}-${episode}-${iframeKey}`}
          src={streamUrl}
          title={`${media.title} Stream`}
          style={{
            width: '100%',
            height: '100%',
            border: 'none'
          }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
        />
      </div>

      {/* Server Selection Modal */}
      {showServerModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowServerModal(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '520px',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '24px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Server size={20} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Select CineHype Server
                </h3>
              </div>
              <button
                onClick={() => setShowServerModal(false)}
                className="interactive"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '18px' }}>
              If a server is buffering or blocked, switch to any mirror below for instant uninterrupted streaming.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {STREAM_SERVERS.map(srv => {
                const isSelected = srv.id === selectedServer;
                return (
                  <button
                    key={srv.id}
                    onClick={() => {
                      setSelectedServer(srv.id);
                      setShowServerModal(false);
                      setIframeKey(k => k + 1);
                    }}
                    className="interactive"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-md)',
                      background: isSelected ? 'rgba(236, 28, 36, 0.16)' : 'rgba(255, 255, 255, 0.04)',
                      border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                      textAlign: 'left'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {srv.name}
                        </span>
                        <span
                          className="badge"
                          style={{
                            background: isSelected ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.1)',
                            color: '#fff',
                            fontSize: '10px'
                          }}
                        >
                          {srv.badge}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--accent-gold)' }}>
                          ⚡ {srv.speed}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {srv.description}
                      </div>
                    </div>

                    {isSelected && (
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          background: 'var(--accent-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff'
                        }}
                      >
                        <Check size={16} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Episodes Drawer (TV Series) */}
      {showEpisodesDrawer && (
        <div
          style={{
            position: 'absolute',
            top: '60px',
            bottom: 0,
            right: 0,
            width: '100%',
            maxWidth: '380px',
            background: 'var(--bg-glass-heavy)',
            backdropFilter: 'blur(20px)',
            borderLeft: '1px solid var(--border-subtle)',
            zIndex: 90,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.7)'
          }}
        >
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>
                Season {season} Episodes
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {episodeList.length} episodes available
              </span>
            </div>
            <button
              onClick={() => setShowEpisodesDrawer(false)}
              className="interactive"
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.08)',
                border: 'none',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {episodeList.map(ep => {
                const isCurrent = ep.episodeNumber === episode;
                return (
                  <button
                    key={ep.id}
                    onClick={() => {
                      if (onSelectEpisode) onSelectEpisode(ep);
                      setShowEpisodesDrawer(false);
                      setIframeKey(k => k + 1);
                    }}
                    className="interactive"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: isCurrent ? 'rgba(236, 28, 36, 0.2)' : 'rgba(255,255,255,0.03)',
                      border: isCurrent ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                      textAlign: 'left'
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '6px',
                        background: isCurrent ? 'var(--accent-primary)' : 'rgba(255,255,255,0.08)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '13px',
                        fontWeight: 800,
                        flexShrink: 0
                      }}
                    >
                      {ep.episodeNumber}
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 700,
                          color: isCurrent ? 'var(--accent-primary)' : 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {ep.name || `Episode ${ep.episodeNumber}`}
                      </div>
                      {ep.runtime && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {ep.runtime} min
                        </div>
                      )}
                    </div>
                    {isCurrent && <Play size={14} fill="var(--accent-primary)" color="var(--accent-primary)" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
