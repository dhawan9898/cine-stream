// VideoPlayer.tsx - Playback for a movie or episode, from a direct stream.
//
// On Android the stream is handed to the native Media3 ExoPlayer screen (the
// same one AniStream uses); this component then only resolves streams and
// relays the player's events (episode picks, next episode, progress). In a
// browser the same stream plays in the hls.js WebPlayer. Provider embed pages
// are never shown: resolution tries every provider and fails if none has a
// direct stream.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import type { MediaItem, EpisodeItem } from '../core/cineHypeCore.ts';
import { resolveStream, type ResolvedStream } from '../services/streamResolver.ts';
import { saveWatchProgress, getUserPreferences } from '../services/historyService.ts';
import { ExoPlayerPlugin, type PlayOptions } from '../plugins/exoPlayerPlugin.ts';
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

const referrerOf = (stream: ResolvedStream): string => stream.headers?.Referer ?? '';

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
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The newest props/callbacks, for listeners that outlive a render.
  const latest = useRef({ media, season, episode, episodeList, onBack, onSelectEpisode });
  latest.current = { media, season, episode, episodeList, onBack, onSelectEpisode };

  // Bumped per request so a slow answer for something the viewer left is dropped.
  const requestRef = useRef(0);
  // The episode the native player is showing. It can run ahead of the props
  // when it starts its prefetched next episode by itself.
  const playingRef = useRef<{ season: number; episode: number } | null>(null);
  const startedRef = useRef(false);

  const episodes = useMemo(
    () => (isSeries ? episodeList.filter(e => e.seasonNumber === season) : []),
    [isSeries, episodeList, season]
  );

  const episodeOptions = useCallback(() => (
    latest.current.episodeList
      .filter(e => e.seasonNumber === latest.current.season)
      .map(e => ({ id: String(e.id), number: String(e.episodeNumber) }))
  ), []);

  const buildPlayOptions = useCallback((
    stream: ResolvedStream,
    ep: number,
    startPositionMs?: number
  ): PlayOptions => {
    const { media: m, season: s } = latest.current;
    const prefs = getUserPreferences();
    return {
      url: stream.url,
      title: m.title,
      episode: String(ep),
      seasonPrefix: m.mediaType === 'tv' ? `S${s}:` : '',
      referer: referrerOf(stream),
      headers: stream.headers,
      subtitles: (stream.subtitles ?? []).map((t, i) => ({ src: t.url, label: t.label || t.lang, default: i === 0 })),
      episodes: m.mediaType === 'tv' ? episodeOptions() : [],
      startPositionMs,
      autoPlayNext: prefs.autoplayNext,
      hasDub: false
    };
  }, [episodeOptions]);

  // Warms the episode after `ep` so Next Episode starts at once.
  const prefetchNext = useCallback((ep: number) => {
    const { media: m, season: s, episodeList: list } = latest.current;
    if (m.mediaType !== 'tv') return;
    const next = list.find(e => e.seasonNumber === s && e.episodeNumber === ep + 1);
    if (!next) return;
    resolveStream({ id: m.id, type: m.mediaType, season: s, episode: next.episodeNumber, server: getUserPreferences().defaultServer })
      .then(stream => ExoPlayerPlugin.setNextEpisode({
        ...buildPlayOptions(stream, next.episodeNumber),
        afterEpisode: String(ep)
      }))
      .catch(() => undefined);
  }, [buildPlayOptions]);

  const saveProgress = useCallback((ep: number, positionMs: number, durationMs: number) => {
    if (durationMs <= 0) return;
    const { media: m, season: s, episodeList: list } = latest.current;
    const data = list.find(e => e.seasonNumber === s && e.episodeNumber === ep);
    saveWatchProgress({
      media: m,
      season: m.mediaType === 'tv' ? s : undefined,
      episode: m.mediaType === 'tv' ? ep : undefined,
      episodeName: data?.name,
      progressPercent: (positionMs / durationMs) * 100
    });
  }, []);

  // ---- Native player events ----
  useEffect(() => {
    if (!isNative) return;
    const handles = [
      ExoPlayerPlugin.addListener('playerClosed', () => {
        requestRef.current++;
        startedRef.current = false;
        latest.current.onBack();
      }),
      ExoPlayerPlugin.addListener('episodeSelected', ({ selectedNumber }) => {
        const { season: s, episodeList: list, onSelectEpisode: select } = latest.current;
        const ep = list.find(e => e.seasonNumber === s && String(e.episodeNumber) === selectedNumber);
        if (ep) select?.(ep);
      }),
      ExoPlayerPlugin.addListener('nextEpisodeRequested', ({ episode: current }) => {
        const { season: s, episodeList: list, onSelectEpisode: select } = latest.current;
        const next = list.find(e => e.seasonNumber === s && String(e.episodeNumber) === String(Number(current) + 1));
        if (next) select?.(next);
      }),
      // The player started the prefetched next episode itself.
      ExoPlayerPlugin.addListener('nextEpisodeStarted', ({ episode: number }) => {
        const { season: s, episodeList: list, onSelectEpisode: select } = latest.current;
        const ep = list.find(e => e.seasonNumber === s && String(e.episodeNumber) === number);
        if (!ep) return;
        playingRef.current = { season: s, episode: ep.episodeNumber };
        select?.(ep);
        prefetchNext(ep.episodeNumber);
      }),
      ExoPlayerPlugin.addListener('reloadRequested', ({ episode: number, positionMs }) => {
        const { media: m, season: s } = latest.current;
        const ep = Number(number) || 1;
        const request = ++requestRef.current;
        resolveStream({ id: m.id, type: m.mediaType, season: s, episode: ep, server: getUserPreferences().defaultServer }, { fresh: true })
          .then(stream => {
            if (request !== requestRef.current) return;
            return ExoPlayerPlugin.play(buildPlayOptions(stream, ep, positionMs));
          })
          .catch(err => {
            if (request !== requestRef.current) return;
            ExoPlayerPlugin.fail({ message: errorMessage(err) }).catch(() => undefined);
          });
      }),
      ExoPlayerPlugin.addListener('progressUpdate', ({ episode: number, positionMs, durationMs }) => {
        saveProgress(Number(number) || 1, positionMs, durationMs);
      })
    ];
    return () => {
      handles.forEach(h => h.then(x => x.remove()).catch(() => undefined));
    };
  }, [buildPlayOptions, prefetchNext, saveProgress]);

  // ---- Resolve + play the requested movie / episode ----
  useEffect(() => {
    const playing = playingRef.current;
    if (isNative && playing && playing.season === season && playing.episode === episode) return;

    const request = ++requestRef.current;
    setError(null);
    setSource(null);

    if (isNative) {
      // First start opens the player; later episode changes reuse the open
      // one (it already shows its own spinner).
      if (!startedRef.current) {
        startedRef.current = true;
        ExoPlayerPlugin.open({
          title: media.title,
          episode: String(episode),
          seasonPrefix: isSeries ? `S${season}:` : ''
        }).catch(() => undefined);
      }
    }

    resolveStream({ id: media.id, type: media.mediaType, season, episode, server: getUserPreferences().defaultServer }, { fresh: attempt > 0 })
      .then(stream => {
        if (request !== requestRef.current) return;
        if (!isNative) {
          setSource(stream);
          return;
        }
        playingRef.current = { season, episode };
        return ExoPlayerPlugin.play(buildPlayOptions(stream, episode)).then(() => prefetchNext(episode));
      })
      .catch(err => {
        if (request !== requestRef.current) return;
        const message = errorMessage(err);
        if (isNative) ExoPlayerPlugin.fail({ message }).catch(() => setError(message));
        else setError(message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id, media.mediaType, season, episode, attempt]);

  useEffect(() => () => {
    requestRef.current++;
    playingRef.current = null;
  }, []);

  const webSource = useMemo<StreamSource | null>(() => source && ({
    streamUrl: source.url,
    quality: source.quality ?? 'Auto',
    referer: referrerOf(source),
    headers: source.headers,
    subtitles: (source.subtitles ?? []).map((t, i) => ({ src: t.url, label: t.label || t.lang, default: i === 0 }))
  }), [source]);

  const webEpisodes = useMemo<PlayerEpisode[]>(
    () => episodes.map(e => ({ id: String(e.id), number: String(e.episodeNumber), title: e.name })),
    [episodes]
  );
  const currentWebEpisode = webEpisodes.find(e => e.number === String(episode));

  const hasNext = isSeries && episodes.some(e => e.episodeNumber === episode + 1);
  const goNext = () => {
    const next = episodes.find(e => e.episodeNumber === episode + 1);
    if (next) onSelectEpisode?.(next);
  };

  // The native player draws everything itself.
  if (isNative && !error) return <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 9999 }} />;

  if (error) {
    return (
      <div className="player-state" role="alert">
        <button onClick={onBack} className="interactive nf-icon-btn" aria-label="Back" style={{ position: 'absolute', top: 'calc(12px + var(--safe-top))', left: '12px' }}>
          <ArrowLeft size={28} />
        </button>
        <h3>Playback failed</h3>
        <p>{error}</p>
        <button className="interactive player-state-btn" onClick={() => setAttempt(n => n + 1)}>Try again</button>
      </div>
    );
  }

  if (!webSource) {
    return (
      <div className="player-state" aria-busy="true">
        <button onClick={onBack} className="interactive nf-icon-btn" aria-label="Back" style={{ position: 'absolute', top: 'calc(12px + var(--safe-top))', left: '12px' }}>
          <ArrowLeft size={28} />
        </button>
        <Loader2 size={44} className="animate-spin" />
        <p>{media.title}{isSeries ? ` · S${season}:E${episode}` : ''}</p>
      </div>
    );
  }

  return (
    <WebPlayer
      streamSource={webSource}
      title={media.title}
      episode={isSeries ? currentWebEpisode ?? { id: String(episode), number: String(episode) } : undefined}
      episodeList={isSeries ? webEpisodes : undefined}
      onBack={onBack}
      hasNextEpisode={hasNext}
      onNextEpisode={goNext}
      onSelectEpisode={ep => {
        const target = episodes.find(e => String(e.episodeNumber) === ep.number);
        if (target) onSelectEpisode?.(target);
      }}
      onProgressUpdate={(time, dur) => saveProgress(episode, time * 1000, dur * 1000)}
    />
  );
};

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Couldn't load this title. Please try again.";
}
