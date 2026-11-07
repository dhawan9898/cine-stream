import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface DownloadSubtitle {
  src: string;
  label: string;
  default?: boolean;
}

export type NativeDownloadState = 'queued' | 'downloading' | 'completed' | 'failed' | 'stopped' | 'removing' | 'removed';

export interface DownloadChangedEvent {
  id: string;
  state: NativeDownloadState;
  percent: number;
  bytes: number;
}

export interface DownloadsPluginInterface {
  // Queues a download of the stream; resolves with the caption files saved
  // beside it (file:// URIs that work offline).
  start(options: {
    id: string;
    url: string;
    referer?: string;
    // Provider headers (Referer / Origin / User-Agent) the CDN requires.
    headers?: Record<string, string>;
    // Highest video height to download (e.g. 720).
    maxHeight?: number;
    subtitles?: DownloadSubtitle[];
  }): Promise<{ subtitles: DownloadSubtitle[] }>;
  remove(options: { id: string }): Promise<void>;
  list(): Promise<{ downloads: DownloadChangedEvent[] }>;
  setPaused(options: { paused: boolean }): Promise<void>;
  addListener(
    eventName: 'downloadChanged',
    listenerFunc: (event: DownloadChangedEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const DownloadsPlugin = registerPlugin<DownloadsPluginInterface>('DownloadsPlugin');
