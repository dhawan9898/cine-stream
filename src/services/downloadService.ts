// downloadService.ts - Offline downloads of movies and episodes (Android app only).
//
// The native DownloadsPlugin owns the video files (Media3 cache); this module
// keeps what the UI needs about each download - the title, how to play it,
// its state - in IndexedDB, and mirrors the native progress events.
//
// Only streams that resolve to a real HLS / DASH / MP4 file can be saved:
// provider embed pages (the web-view fallback) are not downloadable.
import { Capacitor } from '@capacitor/core';
import { DownloadsPlugin, type DownloadChangedEvent, type DownloadSubtitle, type NativeDownloadState } from '../plugins/downloadsPlugin.ts';
import { resolveStream } from '../providers/streamResolver.ts';
import type { MediaItem, MediaType } from '../providers/cineHypeCore.ts';
import { pickAudio, subtitlesForPlayer } from './playbackPrefs.ts';
import { getUserPreferences } from './historyService.ts';
import { cacheRead, cacheWrite, idbDelete, idbGetAll, idbPut } from './offlineStore.ts';

export type DownloadState = 'queued' | 'downloading' | 'completed' | 'failed' | 'stopped';

// The part of a title worth keeping with a download (enough to list and play it).
export type DownloadedMedia = Pick<MediaItem, 'id' | 'title' | 'mediaType' | 'poster' | 'backdrop' | 'overview' | 'releaseDate' | 'voteAverage' | 'language'>;

export interface DownloadRecord {
  id: string;
  media: DownloadedMedia;
  season?: number;
  episode?: number;
  episodeName?: string;
  state: DownloadState;
  percent: number;
  bytes: number;
  createdAt: number;
  // How to play it back offline.
  streamUrl: string;
  referer: string;
  headers?: Record<string, string>;
  subtitles: DownloadSubtitle[];
  error?: string;
  // Retries of a failed download that reused its saved stream link.
  attempts?: number;
}

export const downloadsSupported = (): boolean => Capacitor.isNativePlatform();

export const downloadId = (type: MediaType, mediaId: number, season?: number, episode?: number): string =>
  `${type}|${mediaId}|${season ?? 0}|${episode ?? 0}`;

// ------------------------------------------------------------------- store

let records = new Map<string, DownloadRecord>();
let snapshot: DownloadRecord[] = [];
const listeners = new Set<() => void>();
let ready: Promise<void> | null = null;

const publish = () => {
  snapshot = [...records.values()].sort((a, b) => b.createdAt - a.createdAt);
  listeners.forEach(fn => fn());
};

export const subscribeDownloads = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

export const getDownloadsSnapshot = (): DownloadRecord[] => snapshot;

function toState(s: NativeDownloadState): DownloadState | null {
  return s === 'removing' || s === 'removed' ? null : s;
}

function apply(event: DownloadChangedEvent) {
  const rec = records.get(event.id);
  if (!rec) return;
  const state = toState(event.state);
  if (!state) return;
  const changedState = rec.state !== state;
  const next: DownloadRecord = { ...rec, state, percent: state === 'completed' ? 100 : event.percent, bytes: event.bytes };
  records.set(rec.id, next);
  if (changedState) void idbPut('downloads', next);
  publish();
}

/** Loads saved downloads and starts following the native side. Safe to call repeatedly. */
export function initDownloads(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const saved = await idbGetAll<DownloadRecord>('downloads');
    records = new Map(saved.map(r => [r.id, r]));
    publish();
    if (!downloadsSupported()) return;
    try {
      await DownloadsPlugin.addListener('downloadChanged', apply);
      const { downloads } = await DownloadsPlugin.list();
      const native = new Map(downloads.map(d => [d.id, d]));
      for (const rec of saved) {
        const n = native.get(rec.id);
        if (n) apply(n);
        // Unfinished with nothing behind it natively (e.g. app data cleared mid-way).
        else if (rec.state !== 'completed') {
          records.delete(rec.id);
          void idbDelete('downloads', rec.id);
        }
      }
      // Files without metadata can't be shown or played: free them.
      for (const n of downloads) if (!records.has(n.id)) void DownloadsPlugin.remove({ id: n.id });
      publish();
    } catch (err) {
      console.warn('[downloads] native side unavailable:', err);
    }
  })();
  return ready;
}

// ------------------------------------------------------------------ queries

export const findDownload = (type: MediaType, mediaId: number, season?: number, episode?: number): DownloadRecord | undefined =>
  records.get(downloadId(type, mediaId, season, episode));

/** A finished download of this movie / episode, if there is one. */
export function findCompletedDownload(type: MediaType, mediaId: number, season?: number, episode?: number): DownloadRecord | undefined {
  const rec = findDownload(type, mediaId, season, episode);
  return rec?.state === 'completed' ? rec : undefined;
}

/** Finished downloaded episodes of one series, ordered by season then episode. */
export function completedEpisodes(mediaId: number): DownloadRecord[] {
  return snapshot
    .filter(r => r.media.id === mediaId && r.media.mediaType === 'tv' && r.state === 'completed')
    .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
}

// ------------------------------------------------------------------ actions

const trimMedia = (m: DownloadedMedia): DownloadedMedia => ({
  id: m.id, title: m.title, mediaType: m.mediaType, poster: m.poster, backdrop: m.backdrop,
  overview: m.overview, releaseDate: m.releaseDate, voteAverage: m.voteAverage, language: m.language
});

// Cover art is kept as a data URL so the Downloads list still shows it offline.
async function savePoster(media: DownloadedMedia): Promise<void> {
  const key = `poster:${media.mediaType}:${media.id}`;
  if (!media.poster || await cacheRead(key)) return;
  try {
    const blob = await (await fetch(media.poster)).blob();
    if (blob.size > 600_000) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    await cacheWrite(key, dataUrl);
  } catch {
    // Best effort: the list falls back to the remote URL.
  }
}

export async function getOfflinePoster(type: MediaType, mediaId: number): Promise<string | null> {
  return (await cacheRead<string>(`poster:${type}:${mediaId}`))?.value ?? null;
}

const isDownloadable = (url: string): boolean => /^https?:\/\//i.test(url) && /\.(m3u8|mpd|mp4)(\?|$)/i.test(url);

export async function startDownload(media: DownloadedMedia, season?: number, episode?: number, episodeName?: string): Promise<void> {
  if (!downloadsSupported()) throw new Error('Downloads are only available in the Android app.');
  await initDownloads();
  const id = downloadId(media.mediaType, media.id, season, episode);
  const existing = records.get(id);
  if (existing && existing.state !== 'failed') return;

  // A failed download is retried on the SAME stream link first: the partly
  // downloaded data is cached under that link, so it carries on instead of
  // starting over. Only if that fails again (the link has probably expired)
  // is the partial data dropped and a fresh link resolved.
  const reuseLink = !!existing && existing.state === 'failed' && !!existing.streamUrl && (existing.attempts ?? 0) < 1;
  const placeholder: DownloadRecord = {
    id, media: trimMedia(media), season, episode, episodeName, state: 'queued',
    percent: reuseLink ? existing.percent : 0, bytes: reuseLink ? existing.bytes : 0,
    createdAt: existing?.createdAt ?? Date.now(),
    streamUrl: reuseLink ? existing.streamUrl : '', referer: reuseLink ? existing.referer : '',
    headers: reuseLink ? existing.headers : undefined,
    subtitles: reuseLink ? existing.subtitles : [],
    attempts: reuseLink ? (existing.attempts ?? 0) + 1 : 0
  };
  records.set(id, placeholder);
  publish();

  try {
    let source: { url: string; referer: string; headers?: Record<string, string>; subtitles: DownloadSubtitle[] };
    if (reuseLink) {
      source = { url: existing.streamUrl, referer: existing.referer, headers: existing.headers, subtitles: [] };
    } else {
      if (existing) await DownloadsPlugin.remove({ id }).catch(() => undefined);
      const prefs = getUserPreferences();
      const resolved = await resolveStream(
        { id: media.id, type: media.mediaType, season, episode, language: media.language, title: media.title, fresh: true }
      );
      const url = pickAudio(resolved, prefs.audioLanguage).url;
      if (resolved.isFallbackEmbed || !isDownloadable(url)) {
        throw new Error('This title only has an embedded player right now, which can\'t be downloaded.');
      }
      source = {
        url,
        referer: resolved.headers?.Referer || resolved.headers?.referer || '',
        headers: resolved.headers,
        subtitles: subtitlesForPlayer(resolved.subtitles, prefs.subtitleLanguage)
      };
    }
    const { subtitles } = await DownloadsPlugin.start({
      id,
      url: source.url,
      referer: source.referer,
      headers: source.headers,
      maxHeight: Number(getUserPreferences().downloadQuality || '720'),
      subtitles: source.subtitles
    });
    const rec: DownloadRecord = {
      ...placeholder,
      streamUrl: source.url,
      referer: source.referer,
      headers: source.headers,
      // Captions already saved on an earlier attempt are kept.
      subtitles: subtitles?.length ? subtitles : placeholder.subtitles
    };
    // The native events may already have advanced the state.
    const current = records.get(id);
    const merged = current ? { ...rec, state: current.state, percent: current.percent, bytes: current.bytes } : rec;
    records.set(id, merged);
    await idbPut('downloads', merged);
    publish();
    void savePoster(placeholder.media);
  } catch (err) {
    const failed: DownloadRecord = { ...placeholder, state: 'failed', error: err instanceof Error ? err.message : String(err) };
    records.set(id, failed);
    await idbPut('downloads', failed);
    publish();
    throw err;
  }
}

export async function removeDownload(id: string): Promise<void> {
  await initDownloads();
  const rec = records.get(id);
  records.delete(id);
  publish();
  await idbDelete('downloads', id);
  if (downloadsSupported()) await DownloadsPlugin.remove({ id }).catch(() => undefined);
  // The poster is only needed while something of the title is stored.
  if (rec && ![...records.values()].some(r => r.media.id === rec.media.id && r.media.mediaType === rec.media.mediaType)) {
    await idbDelete('cache', `poster:${rec.media.mediaType}:${rec.media.id}`);
  }
}

export async function removeAllDownloads(): Promise<void> {
  await initDownloads();
  for (const id of [...records.keys()]) await removeDownload(id);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
