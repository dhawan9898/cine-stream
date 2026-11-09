// exoPlayerPlugin.ts - Bridge to the native Media3 ExoPlayer screen
// (ExoPlayerActivity), the same player AniStream uses.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface PlayerSubtitle {
  src: string;
  label: string;
  default?: boolean;
}

export interface QualityOption {
  quality: string;
  url: string;
}

export interface AudioOption {
  label: string;
  url: string;
  qualities?: QualityOption[];
}

export interface PlayEpisodeOption {
  id: string;
  number: string;
}

export interface EpisodeEvent {
  title: string;
  episode: string;
}

export interface EpisodeSelectedEvent extends EpisodeEvent {
  selectedNumber: string;
}

export interface NextEpisodeStartedEvent extends EpisodeEvent {
  url: string;
}

export interface ProgressUpdateEvent extends EpisodeEvent {
  positionMs: number;
  durationMs: number;
}

// The stream failed with an HTTP error; JS resolves it again and play()s it at positionMs.
export interface ReloadRequestedEvent extends EpisodeEvent {
  positionMs: number;
}

export type PlayOptions = Parameters<ExoPlayerPluginInterface['play']>[0];

export interface ExoPlayerPluginInterface {
  play(options: {
    url: string;
    title?: string;
    episode?: string;
    // "S1:" in front of the episode number; empty for a movie.
    seasonPrefix?: string;
    referer?: string;
    headers?: Record<string, string>;
    subtitles?: PlayerSubtitle[];
    qualities?: QualityOption[];
    audios?: AudioOption[];
    // Language code to start with when the stream has several audio tracks.
    preferredAudio?: string;
    // Cap video at 720p on metered (mobile) networks.
    dataSaver?: boolean;
    episodes?: PlayEpisodeOption[];
    intro?: { start: number; end: number };
    outro?: { start: number; end: number };
    startPositionMs?: number;
    spriteVtt?: string;
    autoSkipIntro?: boolean;
    autoPlayNext?: boolean;
    hasDub?: boolean;
    isFallback?: boolean;
    mode?: string;
    // The stream is a download: read it from the offline store.
    offline?: boolean;
  }): Promise<{ success: boolean }>;

  setNextEpisode(options: PlayOptions & { afterEpisode: string }): Promise<void>;

  // Opens the player in its loading state while the stream is resolved.
  open(options: { title?: string; episode?: string; seasonPrefix?: string; mode?: string }): Promise<void>;

  // Loads an embed page in a hidden WebView and returns the first real
  // media request (.m3u8/.mpd/.mp4) it makes. found=false if none appears.
  sniffStream(options: { url: string; referer?: string; timeoutMs?: number; id?: string; background?: boolean }): Promise<{
    found: boolean;
    // A background sniff is refused while a foreground one runs or no WebView is free.
    busy?: boolean;
    cancelled?: boolean;
    url?: string;
    referer?: string;
    headers?: Record<string, string>;
    // Where the time went; -1 when a phase never happened.
    timing?: { pooled: boolean; acquireMs: number; pageMs: number; streamMs: number; totalMs: number };
  }>;

  // Stops a sniff started with the same id and frees its WebView (another server already won).
  cancelSniff(options: { id: string }): Promise<void>;

  // Shows a playback error inside the open player.
  fail(options: { message: string }): Promise<void>;

  addListener(eventName: 'playerClosed', fn: () => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'nextEpisodeRequested', fn: (e: EpisodeEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'episodeSelected', fn: (e: EpisodeSelectedEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'reloadRequested', fn: (e: ReloadRequestedEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'nextEpisodeStarted', fn: (e: NextEpisodeStartedEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'progressUpdate', fn: (e: ProgressUpdateEvent) => void): Promise<PluginListenerHandle>;
}

export const ExoPlayerPlugin = registerPlugin<ExoPlayerPluginInterface>('ExoPlayerPlugin');
