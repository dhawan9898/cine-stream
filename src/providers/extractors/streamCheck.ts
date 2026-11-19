// streamCheck.ts - Looks inside a found stream before it is played: how long it runs and how sharp it is.
//
// Some providers answer a TMDB id with the wrong film (one Rivestream service gave a 108-minute film for
// Devara, which runs almost three hours). The length of an HLS or DASH stream is in its playlist, so a
// stream far shorter or longer than the film's TMDB runtime is a different title and is dropped. The
// playlist also names its renditions, which gives the stream's real quality.
import { CapacitorHttp, Capacitor } from '@capacitor/core';
import type { ExtractedStream } from './types.ts';
import { languageName } from './variantDiscovery.ts';

const CHECK_TIMEOUT_MS = 3500;

export interface StreamFacts {
  /** Running time in minutes, when the playlist tells (a VOD HLS or DASH stream). */
  minutes?: number;
  /** Tallest rendition, e.g. 1080. */
  height?: number;
  /** Audio languages the playlist declares (display names), the default one first. */
  languages?: string[];
}

/** Minutes of a media playlist (sum of its segment lengths); undefined for a live or unreadable one. */
export function hlsMinutes(playlist: string): number | undefined {
  let seconds = 0;
  for (const m of playlist.matchAll(/#EXTINF:\s*([\d.]+)/g)) seconds += Number(m[1]) || 0;
  return seconds > 0 ? seconds / 60 : undefined;
}

/** Minutes of a DASH manifest, from mediaPresentationDuration="PT2H51M39.5S". */
export function dashMinutes(mpd: string): number | undefined {
  const d = mpd.match(/mediaPresentationDuration\s*=\s*"P(?:(\d+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?"/i);
  if (!d) return undefined;
  const minutes = Number(d[1] ?? 0) * 1440 + Number(d[2] ?? 0) * 60 + Number(d[3] ?? 0) + Number(d[4] ?? 0) / 60;
  return minutes > 0 ? minutes : undefined;
}

/**
 * The resolution class of a frame: a wide-screen film is 1920x800, which is 1080p, not 800p. The
 * class is the larger of the height and the height a 16:9 frame of that width would have.
 */
export function nominalHeight(width: number, height: number): number {
  return Math.max(height, Math.round((width * 9) / 16 / 10) * 10);
}

/** Tallest rendition named in an HLS master playlist or DASH manifest (by resolution class). */
export function tallestRendition(text: string): number | undefined {
  const heights = [
    ...[...text.matchAll(/RESOLUTION=(\d+)x(\d+)/gi)].map(m => nominalHeight(Number(m[1]), Number(m[2]))),
    ...[...text.matchAll(/<Representation\b([^>]*)>/gi)].map(m => {
      const h = Number(m[1].match(/\bheight="(\d+)"/i)?.[1] ?? 0);
      const w = Number(m[1].match(/\bwidth="(\d+)"/i)?.[1] ?? 0);
      return h > 0 ? nominalHeight(w, h) : 0;
    })
  ].filter(h => h > 0);
  return heights.length ? Math.max(...heights) : undefined;
}

/**
 * The audio languages an HLS master playlist (EXT-X-MEDIA TYPE=AUDIO) or DASH manifest (audio
 * AdaptationSet lang) declares, the default track first. Unknown codes ("und") are left out.
 */
export function playlistLanguages(text: string): string[] {
  const found: Array<{ name: string; isDefault: boolean }> = [];
  for (const m of text.matchAll(/#EXT-X-MEDIA:([^\n]*)/g)) {
    const attrs = m[1];
    if (!/TYPE=AUDIO/i.test(attrs)) continue;
    const lang = attrs.match(/LANGUAGE="([^"]*)"/i)?.[1];
    const label = attrs.match(/NAME="([^"]*)"/i)?.[1];
    const name = languageName(lang) ?? languageName(label);
    if (name) found.push({ name, isDefault: /DEFAULT=YES/i.test(attrs) });
  }
  for (const m of text.matchAll(/<AdaptationSet\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (!/(contentType|mimeType)="audio/i.test(attrs)) continue;
    const name = languageName(attrs.match(/\blang="([^"]*)"/i)?.[1]);
    if (name) found.push({ name, isDefault: false });
  }
  found.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return [...new Set(found.map(f => f.name))];
}

/**
 * True when a stream of `actual` minutes cannot be a film of `expected` minutes. Cuts differ between
 * releases (censor cuts, credits, intros), so only a large gap counts.
 */
export function isWrongLength(actual: number | undefined, expected: number | undefined): boolean {
  if (!actual || !expected || expected < 40) return false;
  return actual < expected * 0.8 - 5 || actual > expected * 1.25 + 10;
}

/** Height ("1080p", "4K", 720) -> number, or undefined. */
export function heightOf(quality: string | number | undefined): number | undefined {
  if (typeof quality === 'number') return quality > 0 ? quality : undefined;
  if (!quality) return undefined;
  if (/4k|2160/i.test(quality)) return 2160;
  const n = parseInt(quality.match(/(\d{3,4})p?/i)?.[1] ?? '', 10);
  return Number.isFinite(n) && n >= 144 ? n : undefined;
}

async function getText(url: string, headers: Record<string, string> | undefined, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return null;
  const merged = { Accept: '*/*', ...(headers ?? {}) };
  try {
    if (Capacitor.isNativePlatform()) {
      const r = await CapacitorHttp.get({ url, headers: merged, connectTimeout: CHECK_TIMEOUT_MS, readTimeout: CHECK_TIMEOUT_MS, responseType: 'text' });
      if (r.status < 200 || r.status >= 300) return null;
      return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    }
    const timeout = AbortSignal.timeout(CHECK_TIMEOUT_MS);
    const r = await fetch(url, { headers: merged, signal: signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/** Reads a stream's length and quality from its playlist. Never throws; unknowns stay undefined. */
export async function inspectStream(stream: Pick<ExtractedStream, 'url' | 'format' | 'headers'>, signal?: AbortSignal): Promise<StreamFacts> {
  if (stream.format === 'mp4') return {};
  const body = await getText(stream.url, stream.headers, signal);
  if (!body) return {};
  if (/<MPD\b/i.test(body)) return { minutes: dashMinutes(body), height: tallestRendition(body), ...langs(playlistLanguages(body)) };
  if (!body.trimStart().startsWith('#EXTM3U')) return {};
  if (!body.includes('#EXT-X-STREAM-INF')) return { minutes: body.includes('#EXT-X-ENDLIST') || body.includes('#EXTINF') ? hlsMinutes(body) : undefined };
  const height = tallestRendition(body);
  const languages = langs(playlistLanguages(body));
  const lines = body.split('\n').map(l => l.trim());
  const at = lines.findIndex(l => l.startsWith('#EXT-X-STREAM-INF'));
  const variant = at >= 0 ? lines.slice(at + 1).find(l => l && !l.startsWith('#')) : undefined;
  if (!variant) return { height, ...languages };
  let mediaUrl: string;
  try { mediaUrl = new URL(variant, stream.url).toString(); } catch { return { height, ...languages }; }
  const media = await getText(mediaUrl, stream.headers, signal);
  return { height, minutes: media ? hlsMinutes(media) : undefined, ...languages };
}

function langs(list: string[]): { languages?: string[] } {
  return list.length ? { languages: list } : {};
}
