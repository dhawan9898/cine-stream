// base.ts - What every site source shares: the HTTP helpers, the playability probe and the generic
// page walker (resolveFromPage) for sites whose player pages carry the stream address in their markup.
import type { StreamExtractor, ExtractedStream, ExtractorSubtitle, SourceManifest, StreamFormat } from '../core/types.ts';
import { BROWSER_UA, http, type RequestOptions } from '../core/http.ts';
import { PLAYLIST_MEMO_MS } from '../core/streamCheck.ts';
import { discover, pickBest, type FoundStream } from '../core/streamDiscovery.ts';

const PROBE_TIMEOUT_MS = 3500;

/**
 * Do these first bytes of an HLS segment look like video the player can read? MPEG-TS (sync bytes every
 * 188 bytes, allowing a little junk first, as the player's own sniffing does), fragmented MP4, ID3-tagged
 * or raw ADTS audio. A placeholder image, an error page or an empty body is not.
 */
export function looksLikeMediaSegment(b: Uint8Array): boolean {
  if (b.length < 8) return false;
  const limit = Math.min(188, b.length - 1);
  for (let i = 0; i <= limit; i++) {
    if (b[i] !== 0x47) continue;
    const second = i + 188 < b.length ? b[i + 188] === 0x47 : true;
    const third = i + 376 < b.length ? b[i + 376] === 0x47 : true;
    if (second && third && (i + 188 < b.length)) return true;
  }
  const box = String.fromCharCode(b[4], b[5], b[6], b[7]);
  if (['ftyp', 'styp', 'moof', 'sidx', 'moov'].includes(box)) return true;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true; // ID3
  if (b[0] === 0xff && (b[1] & 0xf0) === 0xf0) return true; // ADTS
  return false;
}

export abstract class BaseExtractor implements StreamExtractor {
  abstract id: string;
  abstract name: string;
  abstract mainUrl: string;
  declare manifest?: SourceManifest;

  /** Applies a provider override from the remote config (a new host, mirror list). */
  applyConfig(override: { mainUrl?: string; mirrors?: string[] }): void {
    if (override.mainUrl) this.mainUrl = override.mainUrl;
  }

  protected defaultUserAgent = BROWSER_UA;

  // Requests go through the shared client (core/http.ts). They stay methods so a test can stand in
  // for one provider's network without touching the others.
  protected httpGet(url: string, headers: Record<string, string> = {}, options: Omit<RequestOptions, 'headers'> = {}): Promise<string> {
    return http.text(url, { ...options, headers });
  }

  protected httpPostJson(url: string, body: unknown, headers: Record<string, string> = {}, options: Omit<RequestOptions, 'headers'> = {}): Promise<string> {
    return http.postJson(url, body, { ...options, headers });
  }

  protected httpGetBytes(url: string, headers: Record<string, string> = {}, options: Omit<RequestOptions, 'headers'> = {}): Promise<Uint8Array> {
    return http.bytes(url, { ...options, headers });
  }

  /**
   * Is this stream really playable? A provider can hand out a link whose CDN is dead (a proxy answering
   * 502, an expired token) or whose playlist is fine but whose segments are not: some lanes answer every
   * segment request with a tiny placeholder image, which plays as skips or not at all. Returning such a
   * link would end the lookup on a stream that cannot play. So the playlist is fetched with the headers
   * the player will send, and for HLS the first real segment is fetched too and must hold video data.
   * Network trouble counts as "not playable": the next lane or provider is tried instead.
   *
   * The segment fetch (two more round trips on the way to Play) only runs when `deep` - by default
   * when the provider's manifest says it hands out placeholder lanes (deepProbe). Otherwise the
   * playlist check is enough: playing a link is its own probe, and the player fails over fast.
   */
  protected async probe(stream: { url: string; format: StreamFormat; headers?: Record<string, string> }, signal?: AbortSignal, deep = this.manifest?.deepProbe ?? false): Promise<boolean> {
    if (signal?.aborted) return false;
    // Reject preview clips, samples, and trailers so full movies are never cut off early
    if (/preview|_preview|preview\.m3u8|_trailer|trailer\.m3u8/i.test(stream.url)) return false;
    try {
      if (stream.format === 'mp4') {
        await this.httpGet(stream.url, { ...stream.headers, Range: 'bytes=0-1' }, { signal, timeoutMs: PROBE_TIMEOUT_MS });
        return true;
      }
      // Memoised: the registry reads this same playlist next (length, quality, languages).
      const body = await this.httpGet(stream.url, { ...stream.headers, Accept: '*/*' }, { signal, timeoutMs: PROBE_TIMEOUT_MS, memoMs: PLAYLIST_MEMO_MS });
      if (stream.format === 'dash') return body.includes('<MPD');
      if (!body.trimStart().startsWith('#EXTM3U')) return false;
      if (!deep) return true;

      // Master playlist: continue into its first rendition's media playlist.
      let mediaUrl = stream.url;
      let media = body;
      const lines = body.split('\n').map(l => l.trim());
      const at = lines.findIndex(l => l.startsWith('#EXT-X-STREAM-INF'));
      if (at >= 0) {
        const variant = lines.slice(at + 1).find(l => l && !l.startsWith('#'));
        if (!variant) return false;
        mediaUrl = new URL(variant, stream.url).toString();
        media = await this.httpGet(mediaUrl, { ...stream.headers, Accept: '*/*' }, { signal, timeoutMs: PROBE_TIMEOUT_MS, memoMs: PLAYLIST_MEMO_MS });
        if (!media.trimStart().startsWith('#EXTM3U')) return false;
      }
      const mediaLines = media.split('\n').map(l => l.trim());
      const info = mediaLines.findIndex(l => l.startsWith('#EXTINF'));
      const segment = info >= 0 ? mediaLines.slice(info + 1).find(l => l && !l.startsWith('#')) : undefined;
      if (!segment) return false;
      const bytes = await this.httpGetBytes(new URL(segment, mediaUrl).toString(), { ...stream.headers, Range: 'bytes=0-2047' }, { signal, timeoutMs: PROBE_TIMEOUT_MS });
      return looksLikeMediaSegment(bytes);
    } catch {
      return false;
    }
  }

  protected async resolveFromPage(
    startUrl: string,
    opts: { referer?: string; maxDepth?: number; maxPages?: number; signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<ExtractedStream | null> {
    if (opts.signal?.aborted) return null;
    const maxDepth = opts.maxDepth ?? 2;
    const maxPages = opts.maxPages ?? 4;
    const visited = new Set<string>();
    const subtitles = new Map<string, ExtractorSubtitle>();
    let queue: Array<{ url: string; referer: string }> = [{ url: startUrl, referer: opts.referer ?? this.mainUrl + '/' }];
    const found: Array<FoundStream & { pageUrl: string }> = [];

    for (let depth = 0; depth <= maxDepth && queue.length > 0 && visited.size < maxPages; depth++) {
      if (opts.signal?.aborted) break;
      const next: Array<{ url: string; referer: string }> = [];
      const batch = queue.filter(page => !visited.has(page.url)).slice(0, maxPages - visited.size);
      batch.forEach(page => visited.add(page.url));
      const bodies = await Promise.all(batch.map(async page => {
        try {
          return { page, body: await this.httpGet(page.url, { Referer: page.referer, Accept: '*/*' }, { signal: opts.signal, timeoutMs: opts.timeoutMs }) };
        } catch {
          return null;
        }
      }));
      for (const item of bodies) {
        if (!item) continue;
        const result = discover(item.body, item.page.url);
        result.streams.forEach(s => found.push({ ...s, pageUrl: item.page.url }));
        result.subtitles.forEach(s => subtitles.set(s.url, s));
        result.pages.forEach(p => { if (!visited.has(p)) next.push({ url: p, referer: item.page.url }); });
      }
      if (found.length > 0) break;
      queue = next;
    }

    const best = pickBest(found);
    if (!best) return null;
    const pageObj = found.find(f => f.url === best.url);
    const origin = pageObj ? new URL(pageObj.pageUrl).origin : new URL(this.mainUrl).origin;
    return {
      url: best.url,
      format: best.format,
      quality: best.quality,
      headers: {
        Referer: origin + '/',
        Origin: origin,
        'User-Agent': this.defaultUserAgent
      },
      subtitles: [...subtitles.values()],
      serverId: this.id,
      serverName: this.name
    };
  }

  abstract extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<ExtractedStream | null>;
}
