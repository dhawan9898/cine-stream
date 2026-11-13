// VideoPlayer.tsx - Background stream resolution engine with dual ExoPlayer/WebPlayer (direct streams only, never iframes)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { StreamLoading } from './StreamLoading.tsx';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { getTVSeasonEpisodes, type MediaItem, type EpisodeItem } from '../providers/cineHypeCore.ts';
import { subtitlesForPlayer, pickAudio, applyPreferredQuality } from '../services/playbackPrefs.ts';
import { resolveStream, forgetStream, prefetchUpcomingEpisodes, type ResolvedStream } from '../providers/streamResolver.ts';
import { getResumePositionMs, getUserPreferences, saveWatchProgress } from '../services/historyService.ts';
import { openNativeExoPlayer } from '../services/nativePlayer.ts';
import { ExoPlayerPlugin } from '../plugins/exoPlayerPlugin.ts';
import { findCompletedDownload } from '../services/downloadService.ts';
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

// Longest a stream lookup may keep the loading page up (the lookup's own deadline is about 14 s).
const LOOKUP_GUARD_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
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
  const [langMode] = useState<string>('sub');
  const [selectedServerId, setSelectedServerId] = useState<string | undefined>(undefined);
  const [reportCopied, setReportCopied] = useState(false);
  const sourceRef = useRef<ResolvedStream | null>(null);
  // Servers whose stream failed for this title/episode: the next lookup skips them,
  // so "retry" reaches a different provider instead of the same dead one.
  const failedServersRef = useRef<{ key: string; servers: Set<string> }>({ key: '', servers: new Set() });
  const contentKey = `${media.mediaType}|${media.id}|${season}|${episode}`;
  const failedServers = (key: string = contentKey): string[] => (failedServersRef.current.key === key ? [...failedServersRef.current.servers] : []);
  const markServerFailed = (serverId: string | undefined, key: string = contentKey) => {
    if (!serverId) return;
    if (failedServersRef.current.key !== key) failedServersRef.current = { key, servers: new Set() };
    failedServersRef.current.servers.add(serverId);
  };
  // The native-event listeners below are set up once per episode change; this keeps
  // what they need to know about the current title (season, language, server) fresh.
  const latestRef = useRef({ contentKey, media, season, episode, langMode: 'sub', selectedServerId: undefined as string | undefined });
  useEffect(() => { latestRef.current = { contentKey, media, season, episode, langMode, selectedServerId }; });
  const [fetchedEpisodes, setFetchedEpisodes] = useState<EpisodeItem[]>([]);

  // Holds the resume position requested by ExoPlayerActivity when an HTTP error triggers a fresh reload
  const reloadResumeMsRef = useRef<number | null>(null);
  // Tracks when ExoPlayerActivity already started a prefetched next episode on its own
  const nativePrefetchStartedEpRef = useRef<number | null>(null);

  // Immediately open native ExoPlayer window when mounted on Android
  useEffect(() => {
    if (!isNative) return;
    ExoPlayerPlugin.open({
      title: media.title,
      episode: isSeries ? String(episode) : '1',
      seasonPrefix: isSeries ? `S${season}:` : '',
      mode: langMode
    }).catch(() => {});
  }, [media.title, isSeries, season, episode, langMode]);

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

  // The native player's episode list: number, title, description and thumbnail of every episode.
  const playerEpisodes = useMemo(
    () => episodes.map(e => ({ id: String(e.id), number: String(e.episodeNumber), title: e.name || undefined, synopsis: e.overview || undefined, thumbnail: e.still || undefined })),
    [episodes]
  );
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

  // What the native-event listeners call. They are registered once for the life of this screen and
  // read the current callbacks from here: re-registering on every change left short gaps with no
  // listener, and a "player closed" event landing in one was lost (the app then sat on a loading page).
  const nativeHandlersRef = useRef({ onBack, saveProgress, onSelectEpisode, resolveEpisodeTarget, episode, isSeries });
  useEffect(() => { nativeHandlersRef.current = { onBack, saveProgress, onSelectEpisode, resolveEpisodeTarget, episode, isSeries }; });

  // Native ExoPlayer event listeners (playerClosed, progressUpdate, episode navigation, reloadRequested)
  useEffect(() => {
    if (!isNative) return;
    let disposed = false;
    let handles: PluginListenerHandle[] = [];

    const setupListeners = async () => {
      try {
        const h1 = await ExoPlayerPlugin.addListener('playerClosed', () => {
          nativeHandlersRef.current.onBack();
        });
        const h2 = await ExoPlayerPlugin.addListener('progressUpdate', (e) => {
          const H = nativeHandlersRef.current;
          if (e.positionMs > 0 && e.durationMs > 0) {
            const reportedEp = H.isSeries ? parseInt(e.episode, 10) : undefined;
            H.saveProgress(
              e.positionMs,
              e.durationMs,
              reportedEp && !isNaN(reportedEp) ? reportedEp : undefined
            );
          }
        });
        const h3 = await ExoPlayerPlugin.addListener('episodeSelected', (e) => {
          const H = nativeHandlersRef.current;
          const selectedNum = parseInt(e.selectedNumber || e.episode, 10);
          if (!isNaN(selectedNum) && H.onSelectEpisode) {
            H.onSelectEpisode(H.resolveEpisodeTarget(selectedNum));
          }
        });
        const h4 = await ExoPlayerPlugin.addListener('nextEpisodeRequested', (e) => {
          const H = nativeHandlersRef.current;
          const prevNum = parseInt(e.episode, 10);
          const nextNum = !isNaN(prevNum) ? prevNum + 1 : H.episode + 1;
          if (H.onSelectEpisode) {
            H.onSelectEpisode(H.resolveEpisodeTarget(nextNum));
          }
        });
        const h5 = await ExoPlayerPlugin.addListener('nextEpisodeStarted', (e) => {
          const H = nativeHandlersRef.current;
          const startedNum = parseInt(e.episode, 10);
          if (!isNaN(startedNum) && H.onSelectEpisode) {
            nativePrefetchStartedEpRef.current = startedNum;
            H.onSelectEpisode(H.resolveEpisodeTarget(startedNum));
          }
        });
        const h6 = await ExoPlayerPlugin.addListener('reloadRequested', (e) => {
          reloadResumeMsRef.current = e.positionMs > 0 ? e.positionMs : null;
          // The stream failed: forget it (so it is not served from the cache again),
          // skip that server, and look the title up again on the others.
          const L = latestRef.current;
          markServerFailed(sourceRef.current?.serverId, L.contentKey);
          forgetStream({ id: L.media.id, type: L.media.mediaType, season: L.season, episode: L.episode, languageMode: L.langMode, language: L.media.language, title: L.media.title, preferredServerId: L.selectedServerId });
          setSelectedServerId(undefined);
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
    // markServerFailed only touches refs and a setter; the handlers read everything else from refs.
  }, []);

  // Helper to prefetch the next episode for Native ExoPlayer
  const prefetchNativeNextEpisode = useCallback((currentEp: number) => {
    if (!isNative || !isSeries) return;
    const nextEpNum = currentEp + 1;
    if (!episodes.some(e => e.episodeNumber === nextEpNum)) return;

    resolveStream({ id: media.id, type: media.mediaType, season, episode: nextEpNum, language: media.language, preferredServerId: selectedServerId })
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
          subtitles: subtitlesForPlayer(nextRes.subtitles, prefs.subtitleLanguage),
          isFallback: false,
          autoPlayNext: prefs.autoplayNext
        }).catch(() => {});
      })
      .catch(() => {});
  }, [isSeries, episodes, media.id, media.mediaType, media.title, media.language, season, selectedServerId]);

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
    setReportCopied(false);

    const startPositionMs = reloadResumeMsRef.current ?? initialPositionMs;
    reloadResumeMsRef.current = null;

    // A downloaded copy plays offline, with no stream lookup at all.
    const download = isNative
      ? findCompletedDownload(media.mediaType, media.id, isSeries ? season : undefined, isSeries ? episode : undefined)
      : undefined;
    if (download) {
      const saved: ResolvedStream = {
        id: media.id, type: media.mediaType, season, episode, title: media.title,
        url: download.streamUrl, format: 'hls', headers: download.headers
      };
      setSource(saved);
      sourceRef.current = saved;
      setLoading(false);
      const prefs = getUserPreferences();
      openNativeExoPlayer({
        url: download.streamUrl,
        title: media.title,
        episode: isSeries ? String(episode) : '1',
        seasonPrefix: isSeries ? `S${season}:` : '',
        referer: download.referer,
        headers: download.headers,
        mode: langMode,
        subtitles: download.subtitles,
        episodes: isSeries ? playerEpisodes : undefined,
        startPositionMs: startPositionMs > 0 ? startPositionMs : undefined,
        autoPlayNext: prefs.autoplayNext && hasNextEpisode,
        offline: true
      });
      return () => { active = false; };
    }

    // Leaving this episode (closing, picking another) cancels its lookup so its sniffers and
    // requests stop competing with the one now wanted. A re-run of this effect for the same
    // episode re-attaches to the same lookup instead (see resolveStream).
    const lookup = new AbortController();

    // The lookup has its own deadlines, but whatever happens inside it the screen must end in either a
    // stream or an error with Retry - never an endless loading page.
    withTimeout(
      resolveStream(
        { id: media.id, type: media.mediaType, season, episode, languageMode: langMode, language: media.language, title: media.title, preferredServerId: selectedServerId, exclude: failedServers() },
        { fresh: attempt > 0, signal: lookup.signal }
      ),
      LOOKUP_GUARD_MS,
      'Finding a stream took too long. Try again or pick another server.'
    )
      .then(res => {
        if (!active) return;

        setSource(res);
        sourceRef.current = res;
        setLoading(false);

        // Quietly resolve the next two episodes so they are cached before needed.
        if (isSeries) {
          prefetchUpcomingEpisodes(
            { id: media.id, type: media.mediaType, season, languageMode: langMode, language: media.language, title: media.title, preferredServerId: selectedServerId },
            episode,
            episodes.map(e => e.episodeNumber),
            2
          );
        }

        // On native Android, launch native Media3 Netflix ExoPlayer
        if (isNative && res && res.url && !res.isFallbackEmbed) {
          const prefs = getUserPreferences();
          const audio = applyPreferredQuality(pickAudio(res, prefs.audioLanguage), prefs.defaultQuality);
          openNativeExoPlayer({
            url: audio.url,
            title: media.title,
            episode: isSeries ? String(episode) : '1',
            seasonPrefix: isSeries ? `S${season}:` : '',
            referer: res.headers?.Referer || res.headers?.referer || '',
            headers: res.headers,
            mode: langMode,
            subtitles: subtitlesForPlayer(res.subtitles, prefs.subtitleLanguage),
            preferredAudio: prefs.audioLanguage || undefined,
            dataSaver: prefs.dataSaver,
            qualities: audio.qualities?.map(q => ({ quality: q.quality, url: q.url })),
            audios: res.audios?.map(a => ({
              label: a.label,
              url: a.url,
              qualities: a.qualities?.map(q => ({ quality: q.quality, url: q.url }))
            })),
            episodes: isSeries ? playerEpisodes : undefined,
            startPositionMs: startPositionMs > 0 ? startPositionMs : undefined,
            isFallback: false,
            autoPlayNext: prefs.autoplayNext && hasNextEpisode
          });
          if (hasNextEpisode) {
            prefetchNativeNextEpisode(episode);
          }
        }
      })
      .catch(err => {
        if (!active || lookup.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'Failed to resolve streaming data.';
        setLoading(false);
        setError(message);
        if (isNative) {
          ExoPlayerPlugin.fail({ message }).catch(() => {});
        }
      });

    return () => {
      active = false;
      lookup.abort();
    };
  }, [
    media.id,
    media.mediaType,
    media.language,
    season,
    episode,
    attempt,
    isSeries,
    media.title,
    episodes,
    playerEpisodes,
    hasNextEpisode,
    initialPositionMs,
    prefetchNativeNextEpisode,
    langMode,
    selectedServerId
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
      subtitles: subtitlesForPlayer(source.subtitles, getUserPreferences().subtitleLanguage)
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
        <h3 style={{ fontSize: '20px', fontWeight: 800 }}>Couldn't start playback</h3>
        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', textAlign: 'center', maxWidth: '400px' }}>{error}</p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            className="interactive btn-primary"
            onClick={() => {
              setError(null);
              setLoading(true);
              setAttempt(n => n + 1);
            }}
            style={{ padding: '10px 24px' }}
          >
            Retry
          </button>
          {source?.serverId && (
            <button
              className="interactive btn-secondary"
              onClick={() => {
                // Skip the server that just failed and look the title up on the others.
                markServerFailed(source.serverId);
                setSelectedServerId(undefined);
                setError(null);
                setLoading(true);
                setAttempt(n => n + 1);
              }}
              style={{ padding: '10px 24px', background: 'rgba(255,255,255,0.2)' }}
            >
              Try Next Server
            </button>
          )}
          <button
            className="interactive btn-secondary"
            onClick={() => {
              const details = `CineStream playback report\n${media.title} (${media.mediaType} ${media.id})${isSeries ? ` S${season}E${episode}` : ''}\nServer: ${source?.serverId ?? selectedServerId ?? 'auto'}\nError: ${error}`;
              navigator.clipboard?.writeText(details).then(() => setReportCopied(true)).catch(() => {});
            }}
            style={{ padding: '10px 24px', background: 'rgba(255,255,255,0.2)' }}
          >
            {reportCopied ? 'Copied' : 'Copy Details'}
          </button>
        </div>
      </div>
    );
  }

  // Looking the stream up: the title's backdrop with what is happening (see StreamLoading).
  if (loading || !source) {
    const epName = isSeries ? episodes.find(e => e.episodeNumber === episode)?.name : undefined;
    return (
      <StreamLoading
        key={`${season}:${episode}:${attempt}`}
        title={media.title}
        subtitle={isSeries ? [`S${season}`, `E${episode}`, epName].filter(Boolean).join(' · ') : undefined}
        backdrop={media.backdrop || media.poster}
        onBack={onBack}
      />
    );
  }

  // The native player is open on top: a plain black page underneath.
  if (isNative) {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#000000', zIndex: 9999 }}>
        <button onClick={onBack} className="interactive nf-icon-btn" aria-label="Back" style={{ position: 'absolute', top: 'calc(16px + var(--safe-top))', left: '16px', zIndex: 10 }}>
          <ArrowLeft size={28} color="#fff" />
        </button>
      </div>
    );
  }

  // Direct HLS / MP4 Media Stream Mode for Web
  if (webSource) {
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
        onFailover={() => {
          if (source?.serverId) markServerFailed(source.serverId);
          setAttempt(n => n + 1);
        }}
      />
    );
  }

  // Only direct streams are ever played. Anything else is an error, never an iframe.
  return null;
};
