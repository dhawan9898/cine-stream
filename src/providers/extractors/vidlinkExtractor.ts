// vidlinkExtractor.ts - VidLink through its JSON API (the flow Kunai uses): no embed page, no WebView.
//   1. enc-dec.app/api/enc-vidlink?text=<tmdbId>  -> { result: "<encrypted id>" }
//   2. vidlink.pro/api/b/movie/<enc>  or  /tv/<enc>/<season>/<episode>  -> { stream: { playlist, captions, headers... } }
// The encrypted id depends only on the TMDB id, so it is remembered for 30 minutes.
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream, ExtractorSubtitle } from './types.ts';
import { Cooldown } from './kunaiCommon.ts';

const ENC_DEC = 'https://enc-dec.app/api/enc-vidlink';
const ORIGIN = 'https://vidlink.pro';
const ENC_TTL_MS = 30 * 60_000;
const ENC_CACHE_MAX = 256;
const encCache = new Map<number, { value: string; expires: number }>();

interface VidlinkStream {
  type?: 'hls' | 'file' | 'dash';
  playlist?: string;
  qualities?: Record<string, { url?: string } | undefined>;
  captions?: { url?: string; language?: string; type?: string }[];
  headers?: Record<string, string>;
  playlistHeaders?: Record<string, string>;
}

export class VidLinkExtractor extends BaseExtractor {
  id = 'vidlink';
  name = 'VidLink';
  mainUrl = ORIGIN;
  tier = 'primary' as const;
  // enc-dec.app is a third party VidLink cannot work without: while it is down (or refusing us) VidLink
  // answers nothing at once, so the other providers are not held up by its timeout on every title.
  private encDecDown = new Cooldown();

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    signal?: AbortSignal;
  }): Promise<ExtractedStream | null> {
    if (params.signal?.aborted) return null;
    const { id, type, season = 1, episode = 1, signal } = params;
    const enc = await this.encrypt(id, signal);
    if (!enc) return null;
    const path = type === 'tv' ? `tv/${enc}/${season}/${episode}` : `movie/${enc}`;
    const body = await this.httpGet(
      `${this.mainUrl}/api/b/${path}`,
      { Referer: `${this.mainUrl}/`, Origin: this.mainUrl, Accept: '*/*', 'x-playback-environment': 'webkit' },
      { signal, timeoutMs: 6000 }
    );
    const stream: VidlinkStream | undefined = JSON.parse(body)?.stream;
    if (!stream) return null;

    const headers: Record<string, string> = {
      Referer: `${this.mainUrl}/`,
      Origin: this.mainUrl,
      ...stream.playlistHeaders,
      ...stream.headers
    };
    const subtitles: ExtractorSubtitle[] = (stream.captions ?? [])
      .filter(c => c.url)
      .map(c => ({ url: c.url!, lang: c.language || 'und', label: c.language || 'Subtitle' }));

    if (stream.playlist) {
      const isHls = /\.m3u8(?:[?#]|$)/i.test(stream.playlist) || stream.type === 'hls' || stream.type === undefined;
      const found: ExtractedStream = { url: stream.playlist, format: isHls ? 'hls' : stream.type === 'dash' ? 'dash' : 'mp4', headers, subtitles, serverId: this.id, serverName: this.name };
      return (await this.probe(found, signal)) ? found : null;
    }
    const files = Object.entries(stream.qualities ?? {}).filter(([, f]) => f?.url);
    if (files.length === 0) return null;
    const qualities = files.map(([quality, f]) => ({ quality, url: f!.url! }));
    const found: ExtractedStream = { url: qualities[0].url, quality: qualities[0].quality, format: 'mp4', headers, subtitles, qualities, serverId: this.id, serverName: this.name };
    return (await this.probe(found, signal)) ? found : null;
  }

  private async encrypt(tmdbId: number, signal?: AbortSignal): Promise<string | null> {
    const hit = encCache.get(tmdbId);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (this.encDecDown.active) return null;
    let value: string | undefined;
    try {
      const body = await this.httpGet(`${ENC_DEC}?text=${tmdbId}`, { Accept: 'application/json' }, { signal, timeoutMs: 4000 });
      value = JSON.parse(body)?.result;
    } catch (e) {
      if (!signal?.aborted) this.encDecDown.trip(e instanceof Error && /HTTP 429\b/.test(e.message) ? 60_000 : 30_000);
      throw e;
    }
    if (!value) { this.encDecDown.trip(30_000); return null; }
    encCache.delete(tmdbId);
    encCache.set(tmdbId, { value, expires: Date.now() + ENC_TTL_MS });
    // Bounded: a long session touches many titles (oldest dropped first).
    while (encCache.size > ENC_CACHE_MAX) encCache.delete(encCache.keys().next().value as number);
    return value;
  }
}
