// jellyfin.ts - The viewer's own Jellyfin server as a source (mov-cli's "jellyplex" plugin idea).
//
// Set up in Settings > Sources (server address + an API key from Dashboard > API Keys). A title is found by
// search and matched on the TMDB id Jellyfin stores for it (ProviderIds.Tmdb), falling back to title and year;
// an episode by its season/episode numbers. It returns the file as it is (native: direct play, fastest) and an
// HLS transcode (plays everywhere, also in the web player) as the alternate. Self-hosted, so it is preferred
// over every other source whenever it has the title.
import { Capacitor } from '@capacitor/core';
import { BaseExtractor } from '../extractors/baseExtractor.ts';
import type { ExtractedStream, ExtractorSubtitle, ExtractParams, SourceManifest } from '../extractors/types.ts';
import { getUserPreferences } from '../../services/historyService.ts';
import { idMapper, type SiteTitle } from './idMapper.ts';

interface JfMediaStream { Type?: string; Index?: number; Codec?: string; Language?: string; DisplayTitle?: string; IsTextSubtitleStream?: boolean }
interface JfMediaSource { Id?: string; Container?: string; MediaStreams?: JfMediaStream[] }
interface JfItem {
  Id: string;
  Name?: string;
  Type?: string;
  ProductionYear?: number;
  ProviderIds?: Record<string, string>;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  MediaSources?: JfMediaSource[];
}

export interface JellyfinConfig { url: string; apiKey: string }

/** The configured server, or null when not set up (or not an http(s) address). */
export function jellyfinConfig(): JellyfinConfig | null {
  let prefs: { jellyfinUrl?: string; jellyfinApiKey?: string };
  try { prefs = getUserPreferences(); } catch { return null; }
  const key = (prefs.jellyfinApiKey ?? '').trim();
  const raw = (prefs.jellyfinUrl ?? '').trim().replace(/\/+$/, '');
  if (!key || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
  } catch {
    return null;
  }
  return { url: raw, apiKey: key };
}

const TEXT_SUBS = new Set(['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'mov_text']);

export function toSiteTitle(item: JfItem, tmdbId: number): SiteTitle {
  return {
    siteId: item.Id,
    title: item.Name ?? '',
    type: item.Type === 'Series' ? 'tv' : 'movie',
    year: item.ProductionYear,
    exact: item.ProviderIds?.Tmdb === String(tmdbId) || item.ProviderIds?.tmdb === String(tmdbId)
  };
}

/** Streams for one item: the file as stored (native only) and an HLS transcode; text subtitles as WebVTT. */
export function streamsFor(cfg: JellyfinConfig, item: JfItem, native: boolean): ExtractedStream[] {
  const source = item.MediaSources?.[0];
  const msId = source?.Id ?? item.Id;
  const key = encodeURIComponent(cfg.apiKey);
  const subtitles: ExtractorSubtitle[] = (source?.MediaStreams ?? [])
    .filter(s => s.Type === 'Subtitle' && s.Index !== undefined && (s.IsTextSubtitleStream || TEXT_SUBS.has((s.Codec ?? '').toLowerCase())))
    .map(s => ({
      url: `${cfg.url}/Videos/${item.Id}/${msId}/Subtitles/${s.Index}/0/Stream.vtt?api_key=${key}`,
      lang: (s.Language ?? 'und').slice(0, 3),
      label: s.DisplayTitle ?? s.Language ?? 'Subtitles',
      mimeType: 'text/vtt'
    }));
  const name = 'Jellyfin';
  const hls: ExtractedStream = {
    url: `${cfg.url}/Videos/${item.Id}/master.m3u8?MediaSourceId=${msId}&VideoCodec=h264&AudioCodec=aac,mp3&TranscodingMaxAudioChannels=2&SegmentContainer=ts&DeviceId=cinestream&api_key=${key}`,
    format: 'hls', subtitles, serverId: 'jellyfin', serverName: `${name} (transcode)`
  };
  const container = (source?.Container ?? '').split(',')[0].trim().toLowerCase();
  if (!native || !/^[a-z0-9]{2,5}$/.test(container)) return [hls];
  const direct: ExtractedStream = {
    // The file itself: no transcoding, seeks instantly. ExoPlayer reads mp4/mkv/webm by extension.
    url: `${cfg.url}/Videos/${item.Id}/stream.${container}?static=true&MediaSourceId=${msId}&api_key=${key}`,
    format: 'mp4', subtitles, serverId: 'jellyfin', serverName: `${name} (original)`
  };
  return [direct, hls];
}

export class JellyfinSource extends BaseExtractor {
  id = 'jellyfin';
  name = 'Jellyfin';
  mainUrl = '';
  manifest = { idKind: 'tmdb', costHint: 'instant', priorMs: 300, trust: 'self-hosted' } satisfies SourceManifest;

  available(): boolean {
    return jellyfinConfig() !== null;
  }

  private async getJson<T>(cfg: JellyfinConfig, path: string, signal?: AbortSignal): Promise<T> {
    const body = await this.httpGet(`${cfg.url}${path}`, { 'X-Emby-Token': cfg.apiKey, Accept: 'application/json' }, { signal, timeoutMs: 4000 });
    return JSON.parse(body) as T;
  }

  private async findTitle(cfg: JellyfinConfig, params: ExtractParams): Promise<SiteTitle | null> {
    const kind = params.type === 'tv' ? 'Series' : 'Movie';
    // The mapping is per server: a different server has different item ids.
    const sourceKey = `jellyfin:${cfg.url}`;
    const ref = { tmdbId: params.id, type: params.type, title: params.title, originalTitle: params.originalTitle, year: params.year };
    return idMapper.map(sourceKey, ref, async q => {
      const res = await this.getJson<{ Items?: JfItem[] }>(cfg,
        `/Items?Recursive=true&IncludeItemTypes=${kind}&searchTerm=${encodeURIComponent(q)}&Fields=ProviderIds,ProductionYear&Limit=20`, params.signal);
      const all = (res.Items ?? []).map(i => toSiteTitle(i, params.id));
      // A TMDB-id match is certain; offer only that one when there is one.
      const exact = all.filter(t => t.exact);
      return exact.length ? exact : all;
    });
  }

  async extractAll(params: ExtractParams): Promise<ExtractedStream[]> {
    const cfg = jellyfinConfig();
    if (!cfg || params.signal?.aborted || !params.title) return [];
    try {
      const site = await this.findTitle(cfg, params);
      if (!site) return [];
      let item: JfItem | undefined;
      if (params.type === 'tv') {
        const eps = await this.getJson<{ Items?: JfItem[] }>(cfg,
          `/Shows/${encodeURIComponent(site.siteId)}/Episodes?season=${params.season ?? 1}&Fields=MediaSources`, params.signal);
        item = (eps.Items ?? []).find(e => e.IndexNumber === (params.episode ?? 1) && (e.ParentIndexNumber ?? params.season ?? 1) === (params.season ?? 1));
      } else {
        const res = await this.getJson<{ Items?: JfItem[] }>(cfg, `/Items?Ids=${encodeURIComponent(site.siteId)}&Fields=MediaSources`, params.signal);
        item = res.Items?.[0];
      }
      return item ? streamsFor(cfg, item, Capacitor.isNativePlatform()) : [];
    } catch {
      return [];
    }
  }

  async extract(params: ExtractParams): Promise<ExtractedStream | null> {
    return (await this.extractAll(params))[0] ?? null;
  }

  /** Settings' "Test" button: the server's name, or an error message. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const cfg = jellyfinConfig();
    if (!cfg) return { ok: false, message: 'Enter the server address and an API key.' };
    try {
      const info = await this.getJson<{ ServerName?: string; Version?: string }>(cfg, '/System/Info');
      return { ok: true, message: `Connected to ${info.ServerName ?? 'Jellyfin'}${info.Version ? ` ${info.Version}` : ''}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Could not reach the server.' };
    }
  }
}
