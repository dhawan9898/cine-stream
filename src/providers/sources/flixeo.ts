// flixeo.ts - Flixeo Direct HLS Stream Extractor (vixsrc.to).
// Static page parsing yields direct HLS playlist address and signed tokens inline (window.masterPlaylist).
import { BaseExtractor } from './base.ts';
import type { ExtractedStream, SourceManifest } from '../core/types.ts';

export class FlixeoExtractor extends BaseExtractor {
  id = 'flixeo';
  name = 'Flixeo Server';
  mainUrl = 'https://vixsrc.to';
  manifest = { idKind: 'tmdb', costHint: 'api', priorMs: 3000, strongFor: { kinds: ['tv'] }, trust: 'scraper' } satisfies SourceManifest;

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    signal?: AbortSignal;
  }): Promise<ExtractedStream | null> {
    if (params.signal?.aborted) return null;
    const { id, type, season = 1, episode = 1 } = params;
    const page = type === 'tv' ? `${this.mainUrl}/tv/${id}/${season}/${episode}` : `${this.mainUrl}/movie/${id}`;
    try {
      const html = await this.httpGet(page, { Referer: 'https://flixeo.tv/', Accept: 'text/html,application/xhtml+xml' }, { signal: params.signal, timeoutMs: 3000 });
      const url = parseMasterPlaylist(html);
      if (url) {
        return { url, format: 'hls', headers: { Referer: `${this.mainUrl}/`, Origin: this.mainUrl }, serverId: this.id, serverName: this.name };
      }
    } catch {
      // Direct extraction unavailable
    }
    return null;
  }
}

/**
 * The stream address in a vixsrc player page:
 *   window.masterPlaylist = { params: { 'token': 'T', 'expires': 'E', ... }, url: 'https://…/playlist/1?b=1' }
 *   window.canPlayFHD = true
 * becomes https://…/playlist/1?b=1&token=T&expires=E&h=1. Null when the page has no playlist.
 */
export function parseMasterPlaylist(html: string): string | null {
  const at = html.indexOf('masterPlaylist');
  if (at < 0) return null;
  const block = html.slice(at, at + 1500);
  const pick = (key: string) => block.match(new RegExp(`['"]?${key}['"]?\\s*:\\s*['"]([^'"]+)['"]`))?.[1];
  const base = pick('url');
  const token = pick('token');
  const expires = pick('expires');
  if (!base || !token || !expires || !/^https?:\/\//.test(base)) return null;
  const fhd = /canPlayFHD\s*=\s*true/.test(html);
  return `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}&expires=${encodeURIComponent(expires)}${fhd ? '&h=1' : ''}`;
}
