// flixeoExtractor.ts - Flixeo's player (vixsrc.to).
//
// flixeo.tv/movie/<id> is Flixeo's title page, not a player: it never asks for a stream, so
// sniffing it always timed out. Flixeo's own player ("Server 1") is vixsrc.to, which this extractor
// now uses directly. Its page carries the playlist address and a signed token inline
// (window.masterPlaylist), so when the page can be fetched the stream is read straight from it with
// no WebView; when it cannot (a challenge page), the page is sniffed, starting at once (embedUrl).
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

export class FlixeoExtractor extends BaseExtractor {
  // The id stays 'flixeo' so the speed and health learned so far keep applying.
  id = 'flixeo';
  name = 'Flixeo Server';
  mainUrl = 'https://vixsrc.to';

  embedUrl(params: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number }): string {
    const { id, type, season = 1, episode = 1 } = params;
    return type === 'tv' ? `${this.mainUrl}/tv/${id}/${season}/${episode}` : `${this.mainUrl}/movie/${id}`;
  }

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    signal?: AbortSignal;
  }): Promise<ExtractedStream | null> {
    if (params.signal?.aborted) return null;
    const page = this.embedUrl(params);
    try {
      const html = await this.httpGet(page, { Referer: 'https://flixeo.tv/', Accept: 'text/html,application/xhtml+xml' }, { signal: params.signal, timeoutMs: 3000 });
      const url = parseMasterPlaylist(html);
      if (url) {
        return { url, format: 'hls', headers: { Referer: `${this.mainUrl}/`, Origin: this.mainUrl }, serverId: this.id, serverName: this.name };
      }
    } catch {
      // A challenge page or a network error: the embed is sniffed instead.
    }
    return { url: page, format: 'hls', isFallbackEmbed: true, serverId: this.id, serverName: this.name };
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
