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
    episodes?: PlayEpisodeOption[];
    intro?: { start: number; end: number };
    outro?: { start: number; end: number };
    startPositionMs?: number;
    spriteVtt?: string;
    autoSkipIntro?: boolean;
    autoPlayNext?: boolean;
    hasDub?: boolean;
    isFallback?: boolean;
  }): Promise<{ success: boolean }>;

  setNextEpisode(options: PlayOptions & { afterEpisode: string }): Promise<void>;

  // Opens the player in its loading state while the stream is resolved.
  open(options: { title?: string; episode?: string; seasonPrefix?: string }): Promise<void>;

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
