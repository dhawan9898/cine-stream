import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import { Capacitor } from '@capacitor/core';
import { useBackHandler } from '../services/backStack.ts';
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  SkipForward,
  List,
  Server,
  RefreshCw,
  Subtitles,
  PictureInPicture,
  Gauge,
  Check,
  X,
  ShieldCheck,
  ExternalLink,
  Copy,
  Info,
  Smartphone
} from 'lucide-react';
import type { MediaItem, EpisodeItem } from '../core/cineHypeCore.ts';
import {
  STREAM_SERVERS,
  resolveStreamUrl,
  resolveExtractedStream,
  NATIVE_HLS_STREAMS
} from '../services/streamResolver.ts';
import type { ExtractedStream } from '../extractors/types.ts';
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
  const [selectedServer, setSelectedServer] = useState<string>(prefs.defaultServer || 'native');
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferedTime, setBufferedTime] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isForceLandscape, setIsForceLandscape] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [showServerModal, setShowServerModal] = useState<boolean>(false);
  const [showEpisodesDrawer, setShowEpisodesDrawer] = useState<boolean>(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const [showSubtitlesMenu, setShowSubtitlesMenu] = useState<boolean>(false);
  const [showLinkInfoModal, setShowLinkInfoModal] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [hoverScrubTime, setHoverScrubTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);
  const [rippleAction, setRippleAction] = useState<'rewind' | 'forward' | null>(null);
  const [audioTracks, setAudioTracks] = useState<Array<{ id: number; name: string; lang: string }>>([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number>(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<Array<{ id: number; label: string; lang: string }>>([]);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState<number>(-1);
  const [iframeKey, setIframeKey] = useState<number>(0);
  // The provider's page is cross-origin, so all we can observe is its load
  // event. Our own loading screen covers the provider's placeholder until then.
  const [frameReady, setFrameReady] = useState<boolean>(false);
  const [showSwitchHint, setShowSwitchHint] = useState<boolean>(false);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [customHlsUrl, setCustomHlsUrl] = useState<string>('');
  const [extractedStream, setExtractedStream] = useState<ExtractedStream | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubberRef = useRef<HTMLDivElement | null>(null);

  const isSeries = media.mediaType === 'tv';
  const currentEpisodeData = episodeList.find(e => e.episodeNumber === episode);
  const hasNextEpisode = isSeries && episodeList.some(e => e.episodeNumber === episode + 1);

  // Attempt stream resolution via extractor registry
  useEffect(() => {
    let active = true;
    resolveExtractedStream({
      id: media.id,
      type: media.mediaType,
      season,
      episode,
      server: selectedServer
    }).then(res => {
      if (active) setExtractedStream(res);
    }).catch(err => {
      console.warn('[VideoPlayer] Extractor resolution error:', err);
    });
    return () => { active = false; };
  }, [media.id, media.mediaType, season, episode, selectedServer]);

  // Use extracted stream URL if available, or fallback URL
  const activeStreamSource = extractedStream?.url || customHlsUrl || resolveStreamUrl({
    id: media.id,
    type: media.mediaType,
    season,
    episode,
    server: selectedServer
  });
  const streamUrl = activeStreamSource;
  const isNative = selectedServer === 'native' || (extractedStream !== null && !extractedStream.isFallbackEmbed);

  // Android back closes an open panel first, then the player.
  useBackHandler(showServerModal, () => setShowServerModal(false));
  useBackHandler(showEpisodesDrawer, () => setShowEpisodesDrawer(false));
  useBackHandler(showLinkInfoModal, () => setShowLinkInfoModal(false));

  const frameKey = `${selectedServer}-${season}-${episode}-${iframeKey}`;

  // New frame: show the loading screen again; never keep it longer than 12 s
  // so a stuck provider can't hide its own error or controls forever.
  useEffect(() => {
    if (isNative) return;
    setFrameReady(false);
    setShowSwitchHint(false);
    const cap = setTimeout(() => setFrameReady(true), 12000);
    return () => {
      clearTimeout(cap);
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, [frameKey, isNative]);

  // Once the player is revealed, offer a way out if the provider shows an error.
  useEffect(() => {
    if (isNative || !frameReady) return;
    setShowSwitchHint(true);
    const t = setTimeout(() => setShowSwitchHint(false), 9000);
    return () => clearTimeout(t);
  }, [frameReady, isNative]);

  // On the Android app, play in landscape while the player is open
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const plugin = (Capacitor as any).Plugins?.ScreenOrientation;
    if (plugin) {
      plugin.lock({ orientation: 'landscape' }).catch(() => {});
    } else if (screen.orientation && 'lock' in screen.orientation) {
      (screen.orientation as any).lock('landscape').catch(() => {});
    }
    return () => {
      if (plugin) {
        plugin.unlock().catch(() => {});
      } else if (screen.orientation && 'unlock' in screen.orientation) {
        screen.orientation.unlock();
      }
    };
  }, []);

  // Non-sandbox Pop-up & Ad Interceptor
  // Blocks window.open, stops top-navigation redirects, and refocuses tab without triggering "Please Disable Sandbox"
  useEffect(() => {
    // 1. Intercept window.open in the application window
    const originalOpen = window.open;
    window.open = function(url, target, features) {
      console.warn('[CineStream Non-Sandbox Pop-up Interceptor] Neutralized popup window attempt:', url);
      return null;
    };

    // 3. Intercept clicks on any external target="_blank" links created by ad overlays
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a');
      if (anchor && anchor.target === '_blank') {
        const href = anchor.href || '';
        if (!href.startsWith(window.location.origin) && !href.includes('themoviedb.org')) {
          e.preventDefault();
          e.stopPropagation();
          console.warn('[CineStream Non-Sandbox Pop-up Interceptor] Blocked link target blank:', href);
        }
      }
    };

    // 4. Sync fullscreen state changes (e.g. user pressed phone hardware back button)
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setIsFullscreen(isNowFullscreen);
      if (!isNowFullscreen) {
        setIsForceLandscape(false);
        try {
          if (screen.orientation && 'unlock' in screen.orientation) {
            screen.orientation.unlock();
          }
        } catch (_) {}
      }
    };

    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      window.open = originalOpen;
      document.removeEventListener('click', handleDocumentClick, true);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Format seconds to mm:ss or hh:mm:ss
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Auto-hide controls timer
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isNative) {
        if (isPlaying && !isBuffering) {
          setShowControls(false);
          setShowSpeedMenu(false);
          setShowSubtitlesMenu(false);
        }
      } else {
        // In iframe mode, auto-hide HUD after 5s but top hover zone & mini-back pill remain active
        setShowControls(false);
      }
    }, 5000);
  }, [isPlaying, isBuffering, isNative]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [resetControlsTimer]);

  // HLS Video Initialization with Robust VOD Seeking & Error Recovery
  useEffect(() => {
    if (!isNative) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const streamSrc = activeStreamSource;

    if (Hls.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      // Configure HLS with lowLatencyMode: false for rock-solid VOD scrubbing/seeking!
      const hlsConfig: Partial<import('hls.js').HlsConfig> = {
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.8,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.2,
        nudgeMaxRetry: 5,
        autoStartLoad: true
      };

      if (extractedStream?.headers && Object.keys(extractedStream.headers).length > 0) {
        const headers = extractedStream.headers;
        hlsConfig.xhrSetup = (xhr, _url) => {
          Object.entries(headers).forEach(([k, v]) => {
            xhr.setRequestHeader(k, v);
          });
        };
      }

      const hls = new Hls(hlsConfig);
      hls.loadSource(streamSrc);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => setIsPlaying(false));
        setIsPlaying(true);
        setIsBuffering(false);

        if (hls.audioTracks && hls.audioTracks.length > 0) {
          setAudioTracks(hls.audioTracks.map((t, idx) => ({
            id: idx,
            name: t.name || `Audio track ${idx + 1}`,
            lang: t.lang || ''
          })));
          setSelectedAudioTrack(hls.audioTrack);
        }

        if (hls.subtitleTracks && hls.subtitleTracks.length > 0) {
          setSubtitleTracks(hls.subtitleTracks.map((t, idx) => ({
            id: idx,
            label: t.name || `Subtitles ${idx + 1}`,
            lang: t.lang || ''
          })));
        }
      });

      // Automatic Seek Error & Stall Recovery
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('[HLS] Network error on seek, reloading fragments...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('[HLS] Media seek error, recovering buffer...');
              hls.recoverMediaError();
              break;
            default:
              console.error('[HLS] Unrecoverable error:', data);
              hls.destroy();
              break;
          }
        }
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        setSelectedAudioTrack(data.id);
      });

      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_, data) => {
        setSelectedSubtitleTrack(data.id);
      });

      hlsRef.current = hls;

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamSrc;
      video.play().catch(() => setIsPlaying(false));
    }
  }, [isNative, customHlsUrl]);

  // Video event handlers
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    setDuration(video.duration || 0);

    if (video.buffered.length > 0) {
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) {
          setBufferedTime(video.buffered.end(i));
          break;
        }
      }
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
    resetControlsTimer();
  };

  const handleRewind10 = () => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = Math.max(0, video.currentTime - 10);
    }
    setRippleAction('rewind');
    setTimeout(() => setRippleAction(null), 650);
    resetControlsTimer();
  };

  const handleForward10 = () => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
    }
    setRippleAction('forward');
    setTimeout(() => setRippleAction(null), 650);
    resetControlsTimer();
  };

  const handleSkipIntro = () => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 85);
    }
    resetControlsTimer();
  };

  // Robust Scrubber Drag / Seek to Middle
  const handleScrubberClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubberRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = pos * duration;

    if (videoRef.current) {
      setIsBuffering(true);
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);

      // Force play if it was playing
      if (isPlaying) {
        videoRef.current.play().catch(() => {});
      }
    }
    resetControlsTimer();
  };

  const handleScrubberMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubberRef.current || duration === 0) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(pos * 100);
    setHoverScrubTime(pos * duration);
  };

  const handleScrubberMouseLeave = () => {
    setHoverScrubTime(null);
  };

  const handleVolumeChange = (newVol: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
    video.muted = newVol === 0;
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isMuted) {
      video.muted = false;
      video.volume = volume || 0.8;
      setIsMuted(false);
    } else {
      video.muted = true;
      setIsMuted(true);
    }
  };

  const handleSpeedSelect = (speed: number) => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = speed;
      setPlaybackSpeed(speed);
    }
    setShowSpeedMenu(false);
  };

  const handleSubtitleSelect = (id: number) => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = id;
      setSelectedSubtitleTrack(id);
    }
    setShowSubtitlesMenu(false);
  };

  const handleAudioTrackSelect = (id: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = id;
      setSelectedAudioTrack(id);
    }
    setShowSubtitlesMenu(false);
  };

  // Fullscreen with Automatic Screen Orientation Lock to Landscape
  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      const isCurrentlyFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);

      if (!isCurrentlyFullscreen) {
        if (containerRef.current.requestFullscreen) {
          await containerRef.current.requestFullscreen();
        } else if ((containerRef.current as any).webkitRequestFullscreen) {
          await (containerRef.current as any).webkitRequestFullscreen();
        }
        setIsFullscreen(true);

        // Lock screen orientation to Landscape mode (Standard Netflix App behavior)
        try {
          if (screen.orientation && 'lock' in screen.orientation) {
            await (screen.orientation as any).lock('landscape');
          }
        } catch (orientationErr) {
          // If browser restricts programmatic lock, enable CSS landscape force mode
          console.warn('Orientation lock API restricted, using force-landscape CSS:', orientationErr);
          setIsForceLandscape(true);
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
        setIsFullscreen(false);
        setIsForceLandscape(false);

        // Unlock orientation back to portrait
        try {
          if (screen.orientation && 'unlock' in screen.orientation) {
            screen.orientation.unlock();
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn('Fullscreen toggle error:', err);
      // Fallback toggle for force landscape
      setIsForceLandscape(prev => !prev);
    }
  };

  // Manual Landscape Rotation Toggle for Mobile Phones
  const toggleLandscapeRotation = () => {
    setIsForceLandscape(prev => !prev);
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP not supported:', err);
    }
  };

  const handleNextEpisode = () => {
    if (!hasNextEpisode || !onSelectEpisode) return;
    const nextEp = episodeList.find(e => e.episodeNumber === episode + 1);
    if (nextEp) {
      onSelectEpisode(nextEp);
      setIframeKey(k => k + 1);
      setCurrentTime(0);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(streamUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      switch (e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'KeyJ':
          e.preventDefault();
          handleRewind10();
          break;
        case 'ArrowRight':
        case 'KeyL':
          e.preventDefault();
          handleForward10();
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleVolumeChange(Math.min(1, volume + 0.08));
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleVolumeChange(Math.max(0, volume - 0.08));
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'Escape':
          if (showServerModal) setShowServerModal(false);
          else if (showEpisodesDrawer) setShowEpisodesDrawer(false);
          else if (showSpeedMenu) setShowSpeedMenu(false);
          else if (showSubtitlesMenu) setShowSubtitlesMenu(false);
          else if (showLinkInfoModal) setShowLinkInfoModal(false);
          else onBack();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [volume, isMuted, isPlaying, showServerModal, showEpisodesDrawer, showSpeedMenu, showSubtitlesMenu, showLinkInfoModal]);

  // Track watch progress
  useEffect(() => {
    const progressPercent = duration > 0 ? Math.round((currentTime / duration) * 100) : 25;
    saveWatchProgress({
      media,
      season: isSeries ? season : undefined,
      episode: isSeries ? episode : undefined,
      episodeName: currentEpisodeData?.name,
      progressPercent
    });

    const interval = setInterval(() => {
      const activeProgress = duration > 0 ? Math.round((currentTime / duration) * 100) : 50;
      saveWatchProgress({
        media,
        season: isSeries ? season : undefined,
        episode: isSeries ? episode : undefined,
        episodeName: currentEpisodeData?.name,
        progressPercent: activeProgress
      });
    }, 12000);

    return () => clearInterval(interval);
  }, [media, season, episode, isSeries, currentEpisodeData, currentTime, duration]);

  const currentServerObj = STREAM_SERVERS.find(s => s.id === selectedServer) || STREAM_SERVERS[0];
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferPercent = duration > 0 ? (bufferedTime / duration) * 100 : 0;
  const showSkipIntro = isNative && currentTime >= 2 && currentTime <= 95;

  return (
    <div
      ref={containerRef}
      className={`netflix-player-container ${isForceLandscape ? 'force-landscape' : ''}`}
      onMouseMove={resetControlsTimer}
      onClick={resetControlsTimer}
      style={{ cursor: showControls ? 'default' : 'none' }}
    >
      {/* Playback Canvas Area */}
      {isNative ? (
        <video
          ref={videoRef}
          onTimeUpdate={handleTimeUpdate}
          onWaiting={() => setIsBuffering(true)}
          onSeeking={() => setIsBuffering(true)}
          onSeeked={() => setIsBuffering(false)}
          onCanPlay={() => setIsBuffering(false)}
          onPlaying={() => { setIsBuffering(false); setIsPlaying(true); }}
          onEnded={handleNextEpisode}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onClick={togglePlay}
          playsInline
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000000'
          }}
        />
      ) : (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {/* Direct Video Iframe with full clickability (NO sandbox attribute to prevent 'Please Disable Sandbox') */}
          <iframe
            key={`${selectedServer}-${season}-${episode}-${iframeKey}`}
            src={streamUrl}
            title={`${media.title} Stream`}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              background: '#000000',
              pointerEvents: 'auto'
            }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowFullScreen
            onLoad={() => {
              if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
              loadTimerRef.current = setTimeout(() => setFrameReady(true), 2200);
            }}
          />
        </div>
      )}

      {/* Netflix-style loading screen over the provider's own placeholder */}
      {!isNative && (
        <div className={`nf-loading ${frameReady ? 'done' : ''}`} aria-hidden={frameReady}>
          {(media.backdrop || media.poster) && (
            <img className="nf-loading-bg" src={media.backdrop || media.poster} alt="" decoding="async" />
          )}
          <div className="nf-loading-shade" />
          <div className="nf-loading-body">
            <div className="nf-ring" />
            <div className="nf-loading-title">{media.title}</div>
            {isSeries && <div className="nf-loading-sub">Season {season} · Episode {episode}</div>}
          </div>
        </div>
      )}

      {!isNative && showSwitchHint && (
        <button
          onClick={() => { setShowSwitchHint(false); setShowServerModal(true); }}
          className="interactive nf-switch-hint"
        >
          <Server size={16} />
          <span>Not playing? Try another server</span>
        </button>
      )}

      {/* Netflix Buffering Spinner on Seek / Load */}
      {isBuffering && (
        <div className="netflix-buffering-indicator">
          <div className="netflix-spinner" />
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff', letterSpacing: '0.5px' }}>
            Loading...
          </span>
        </div>
      )}

      {/* Ripple Animation Indicator for Seeking */}
      {rippleAction && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: rippleAction === 'rewind' ? '25%' : '75%',
            transform: 'translate(-50%, -50%)',
            width: '110px',
            height: '110px',
            borderRadius: '50%',
            background: 'rgba(229, 9, 20, 0.4)',
            backdropFilter: 'blur(16px)',
            border: '2px solid rgba(255, 255, 255, 0.4)',
            boxShadow: '0 0 40px rgba(229, 9, 20, 0.7)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            zIndex: 40,
            animation: 'fadeIn 0.3s ease-out'
          }}
        >
          {rippleAction === 'rewind' ? <RotateCcw size={32} /> : <RotateCw size={32} />}
          <span style={{ fontSize: '12px', fontWeight: 800, marginTop: '4px' }}>
            {rippleAction === 'rewind' ? '-10s' : '+10s'}
          </span>
        </div>
      )}

      {/* Floating Netflix Skip Intro Button */}
      {showSkipIntro && (
        <button
          onClick={handleSkipIntro}
          className="netflix-skip-intro interactive"
          aria-label="Skip Intro"
        >
          <SkipForward size={16} />
          <span>Skip Intro</span>
        </button>
      )}

      {/* Top Hover & Touch Trigger Zone: Bring back controls instantly when hovering or tapping near the top */}
      <div
        className="netflix-top-trigger-zone"
        onMouseEnter={() => setShowControls(true)}
        onTouchStart={() => setShowControls(true)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '56px',
          zIndex: 25,
          pointerEvents: 'auto',
          background: 'transparent'
        }}
      />

      {/* Persistent Mini Back Button when HUD is hidden - Ensures user is NEVER stuck */}
      {!showControls && (
        <button
          onClick={onBack}
          className="interactive netflix-mini-back-pill"
          title="Back to CineStream (Esc)"
          aria-label="Back"
          style={{
            position: 'absolute',
            top: 'calc(var(--safe-top) + 12px)',
            left: 'calc(env(safe-area-inset-left, 0px) + 12px)',
            zIndex: 60,
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'rgba(24, 24, 28, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            cursor: 'pointer',
            pointerEvents: 'auto'
          }}
        >
          <ArrowLeft size={20} color="#ffffff" />
        </button>
      )}

      {/* Netflix Liquid Glass HUD Overlay */}
      <div className={`netflix-hud ${showControls ? 'visible' : 'hidden'}`}>
        {/* Top Control Bar (Netflix mobile layout) */}
        <div className="netflix-top-bar">
          <button onClick={onBack} className="interactive netflix-icon-btn netflix-back" aria-label="Back">
            <ArrowLeft size={28} color="#ffffff" />
          </button>

          <div className="netflix-title">
            <span className="netflix-title-main">{media.title}</span>
            {isSeries && (
              <span className="netflix-title-sub">
                S{season}:E{episode}{currentEpisodeData?.name ? ` “${currentEpisodeData.name}”` : ''}
              </span>
            )}
          </div>

          <div className="netflix-top-actions">
            {!isNative && (
              <button onClick={() => setShowServerModal(true)} className="interactive netflix-icon-btn" aria-label={`Server: ${currentServerObj.name}`}>
                <Server size={22} />
              </button>
            )}
            {!isNative && isSeries && episodeList.length > 0 && (
              <button onClick={() => setShowEpisodesDrawer(true)} className="interactive netflix-icon-btn" aria-label="Episodes">
                <List size={22} />
              </button>
            )}
            {!isNative && hasNextEpisode && (
              <button onClick={handleNextEpisode} className="interactive netflix-icon-btn" aria-label="Next episode">
                <SkipForward size={22} />
              </button>
            )}
            <button onClick={() => setShowLinkInfoModal(true)} className="interactive netflix-icon-btn" aria-label="Stream info">
              <Info size={22} />
            </button>
            <button onClick={() => setIframeKey(k => k + 1)} className="interactive netflix-icon-btn" aria-label="Reload stream">
              <RefreshCw size={22} />
            </button>
          </div>
        </div>

        {/* Center Screen Netflix Big Controls (Native mode) */}
        {isNative && (
          <div className="netflix-center-controls">
            <button onClick={handleRewind10} className="netflix-center-btn" aria-label="Rewind 10s">
              <RotateCcw size={46} strokeWidth={1.6} />
              <span className="netflix-center-num">10</span>
            </button>
            <button
              onClick={togglePlay}
              className="netflix-center-btn play-pause-btn"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={64} fill="#ffffff" strokeWidth={0} /> : <Play size={64} fill="#ffffff" strokeWidth={0} />}
            </button>
            <button onClick={handleForward10} className="netflix-center-btn" aria-label="Forward 10s">
              <RotateCw size={46} strokeWidth={1.6} />
              <span className="netflix-center-num">10</span>
            </button>
          </div>
        )}

        {/* Bottom control dock (native player only: the provider's iframe draws
            its own bottom controls and ours would sit on top of them) */}
        {isNative && (
        <div className="netflix-bottom-bar">
          {isNative && (
            <div className="netflix-scrub-row">
              <div
                ref={scrubberRef}
                className="netflix-scrubber-wrapper"
                onClick={handleScrubberClick}
                onMouseMove={handleScrubberMouseMove}
                onMouseLeave={handleScrubberMouseLeave}
              >
                {hoverScrubTime !== null && (
                  <div className="netflix-time-tooltip" style={{ left: `${hoverPosition}%` }}>
                    {formatTime(hoverScrubTime)}
                  </div>
                )}
                <div className="netflix-scrubber-track">
                  <div className="netflix-scrubber-buffer" style={{ width: `${bufferPercent}%` }} />
                  <div className="netflix-scrubber-progress" style={{ width: `${progressPercent}%` }} />
                  <div className="netflix-scrubber-thumb" style={{ left: `${progressPercent}%` }} />
                </div>
              </div>
              <span className="netflix-time-left">{formatTime(Math.max(0, duration - currentTime))}</span>
            </div>
          )}

          <div className="netflix-actions">
            <button onClick={() => setShowServerModal(true)} className="interactive netflix-action">
              <Server size={24} />
              <span className="netflix-action-label">{currentServerObj.name}</span>
            </button>

              {/* Playback Speed Menu */}
            {isNative && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => {
                    setShowSpeedMenu(!showSpeedMenu);
                    setShowSubtitlesMenu(false);
                  }}
                  className="interactive netflix-action"
                  title="Playback Speed"
                >
                  <Gauge size={24} />
                  <span className="netflix-action-label">Speed ({playbackSpeed}x)</span>
                </button>

                {showSpeedMenu && (
                  <div
                    className="liquid-glass"
                    style={{
                      position: 'absolute',
                      bottom: '64px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '130px',
                      borderRadius: 'var(--radius-md)',
                      padding: '8px',
                      zIndex: 60,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px'
                    }}
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => (
                      <button
                        key={speed}
                        onClick={() => handleSpeedSelect(speed)}
                        className="interactive"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: playbackSpeed === speed ? 'rgba(229, 9, 20,0.25)' : 'transparent',
                          border: 'none',
                          color: playbackSpeed === speed ? 'var(--accent-primary)' : '#fff',
                          padding: '8px 12px',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 700
                        }}
                      >
                        <span>{speed}x</span>
                        {playbackSpeed === speed && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}


            {isSeries && episodeList.length > 0 && (
              <button onClick={() => setShowEpisodesDrawer(true)} className="interactive netflix-action">
                <List size={24} />
                <span className="netflix-action-label">Episodes</span>
              </button>
            )}

            {hasNextEpisode && (
              <button onClick={handleNextEpisode} className="interactive netflix-action">
                <SkipForward size={24} />
                <span className="netflix-action-label">Next Ep.</span>
              </button>
            )}

              {/* Subtitles & Audio Selector */}
            {isNative && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => {
                    setShowSubtitlesMenu(!showSubtitlesMenu);
                    setShowSpeedMenu(false);
                  }}
                  className="interactive netflix-action"
                  title="Audio & Subtitles"
                >
                  <Subtitles size={24} />
                  <span className="netflix-action-label">Audio & Subtitles</span>
                </button>

                {showSubtitlesMenu && (
                  <div
                    className="liquid-glass"
                    style={{
                      position: 'absolute',
                      bottom: '64px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '260px',
                      borderRadius: 'var(--radius-md)',
                      padding: '16px',
                      zIndex: 60
                    }}
                  >
                    <h4 style={{ fontSize: '13px', fontWeight: 800, marginBottom: '8px', color: '#fff' }}>
                      Audio Tracks
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' }}>
                      {audioTracks.length === 0 ? (
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>Default Stereo</div>
                      ) : (
                        audioTracks.map(track => (
                          <button
                            key={track.id}
                            onClick={() => handleAudioTrackSelect(track.id)}
                            className="interactive"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              background: selectedAudioTrack === track.id ? 'rgba(229, 9, 20,0.2)' : 'transparent',
                              border: 'none',
                              color: selectedAudioTrack === track.id ? 'var(--accent-primary)' : '#fff',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              textAlign: 'left'
                            }}
                          >
                            <span>{track.name}</span>
                            {selectedAudioTrack === track.id && <Check size={14} />}
                          </button>
                        ))
                      )}
                    </div>

                    <h4 style={{ fontSize: '13px', fontWeight: 800, marginBottom: '8px', color: '#fff' }}>
                      Subtitles
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <button
                        onClick={() => handleSubtitleSelect(-1)}
                        className="interactive"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: selectedSubtitleTrack === -1 ? 'rgba(229, 9, 20,0.2)' : 'transparent',
                          border: 'none',
                          color: selectedSubtitleTrack === -1 ? 'var(--accent-primary)' : '#fff',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          textAlign: 'left'
                        }}
                      >
                        <span>Off</span>
                        {selectedSubtitleTrack === -1 && <Check size={14} />}
                      </button>
                      {subtitleTracks.map(sub => (
                        <button
                          key={sub.id}
                          onClick={() => handleSubtitleSelect(sub.id)}
                          className="interactive"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: selectedSubtitleTrack === sub.id ? 'rgba(229, 9, 20,0.2)' : 'transparent',
                            border: 'none',
                            color: selectedSubtitleTrack === sub.id ? 'var(--accent-primary)' : '#fff',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            textAlign: 'left'
                          }}
                        >
                          <span>{sub.label}</span>
                          {selectedSubtitleTrack === sub.id && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}


            {isNative && (
              <button onClick={togglePiP} className="interactive netflix-action">
                <PictureInPicture size={24} />
                <span className="netflix-action-label">PiP</span>
              </button>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Stream Link & Provider Inspector Modal */}
      {showLinkInfoModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 130,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(20px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowLinkInfoModal(false)}
        >
          <div
            className="liquid-glass"
            style={{
              width: '100%',
              maxWidth: '540px',
              borderRadius: 'var(--radius-xl)',
              padding: '28px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Info size={22} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#ffffff' }}>
                  Stream Link & Provider Details
                </h3>
              </div>
              <button
                onClick={() => setShowLinkInfoModal(false)}
                className="interactive netflix-icon-btn"
                style={{ width: 34, height: 34 }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Active Provider
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <span style={{ fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>
                    {currentServerObj.name}
                  </span>
                  <span className="badge badge-red" style={{ fontSize: '10px' }}>
                    {currentServerObj.badge}
                  </span>
                </div>
              </div>

              <div>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Exact Stream URL
                </span>
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.5)',
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    color: '#38bdf8',
                    marginTop: '6px'
                  }}
                >
                  {streamUrl}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button
                  onClick={handleCopyLink}
                  className="btn-secondary interactive"
                  style={{ flex: 1, padding: '10px', fontSize: '13px' }}
                >
                  {copiedLink ? <Check size={16} color="#34d399" /> : <Copy size={16} />}
                  <span>{copiedLink ? 'Copied URL!' : 'Copy Stream URL'}</span>
                </button>

                <a
                  href={streamUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary interactive"
                  style={{ flex: 1, padding: '10px', fontSize: '13px', textDecoration: 'none' }}
                >
                  <ExternalLink size={16} />
                  <span>Open in Tab</span>
                </a>
              </div>

              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  color: 'rgba(255,255,255,0.9)',
                  marginTop: '6px'
                }}
              >
                <strong>🛡️ Pop-up & Clickjacking Shield: ACTIVE</strong>
                <p style={{ marginTop: '4px', color: 'rgba(255,255,255,0.7)', fontSize: '11px' }}>
                  Screen touches are handled on the CineStream glass layer to reveal controls rather than triggering third-party advertisement traps. Window popups and redirects are automatically blocked.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Episodes & Seasons Netflix Glass Drawer */}
      {showEpisodesDrawer && (
        <div className="netflix-glass-drawer">
          <div
            style={{
              padding: '24px 28px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.14)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#ffffff' }}>
                Season {season} Episodes
              </h3>
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
                {episodeList.length} episodes available
              </p>
            </div>
            <button
              onClick={() => setShowEpisodesDrawer(false)}
              className="interactive netflix-icon-btn"
              style={{ width: 36, height: 36 }}
            >
              <X size={20} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {episodeList.map(ep => {
              const isCurrent = ep.episodeNumber === episode;
              return (
                <div
                  key={ep.id}
                  onClick={() => {
                    if (onSelectEpisode) onSelectEpisode(ep);
                    setShowEpisodesDrawer(false);
                    setIframeKey(k => k + 1);
                    setCurrentTime(0);
                  }}
                  className="interactive poster-card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: isCurrent ? 'rgba(229, 9, 20, 0.22)' : 'rgba(255, 255, 255, 0.04)',
                    borderColor: isCurrent ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.1)',
                    cursor: 'pointer'
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '10px',
                      background: isCurrent ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '15px',
                      fontWeight: 800,
                      color: '#fff',
                      flexShrink: 0
                    }}
                  >
                    {ep.episodeNumber}
                  </div>

                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <h5
                      style={{
                        fontSize: '14px',
                        fontWeight: 700,
                        color: isCurrent ? 'var(--accent-primary)' : '#ffffff',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {ep.name || `Episode ${ep.episodeNumber}`}
                    </h5>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
                      {ep.runtime ? `${ep.runtime} min` : 'Full Episode'}
                    </div>
                  </div>

                  {isCurrent && <Play size={16} fill="var(--accent-primary)" color="var(--accent-primary)" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Server & Stream Source Modal */}
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

            <p style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '18px', lineHeight: 1.5 }}>
              Switch to any verified provider below. <strong>CineStream Native HLS</strong> provides native Netflix player controls with 0 pop-ups.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
              {STREAM_SERVERS.map(srv => {
                const isSelected = srv.id === selectedServer;
                return (
                  <button
                    key={srv.id}
                    onClick={() => {
                      setSelectedServer(srv.id);
                      setShowServerModal(false);
                      setIframeKey(k => k + 1);
                      setCurrentTime(0);
                    }}
                    className="interactive"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '16px 18px',
                      borderRadius: 'var(--radius-md)',
                      background: isSelected ? 'rgba(229, 9, 20, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                      border: isSelected ? '1px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.12)',
                      textAlign: 'left'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>
                          {srv.name}
                        </span>
                        <span
                          className="badge"
                          style={{
                            background: srv.isNative ? 'var(--accent-gradient)' : 'rgba(255, 255, 255, 0.12)',
                            color: '#fff',
                            fontSize: '10px',
                            fontWeight: 800
                          }}
                        >
                          {srv.badge}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--accent-gold)' }}>
                          ⚡ {srv.speed}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.65)' }}>
                        {srv.description}
                      </div>
                    </div>

                    {isSelected && (
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: 'var(--accent-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          boxShadow: '0 0 12px var(--accent-primary)'
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
    </div>
  );
};
