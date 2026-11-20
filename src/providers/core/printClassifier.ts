// printClassifier.ts - Tells a theatrical print (CAM, TS, TC, PreDVD, S-Print...) from an original one
// (WEB-DL, WEBRip, HDRip, BluRay, OTT/TMDB API sources).
//
// The print is the first thing the stream election ranks by (see extractorRegistry.ts#compareStreams):
// an original print always beats a theatrical one, whatever its resolution or language. A stream is an
// original print unless something about it says theatrical - the API providers name no print at all and
// carry retail releases.
import type { ExtractedStream } from './types.ts';

// In names written by people (release titles, server names, quality labels).
const THEATER_PRINT_RE = /\b(cam|camrip|cam-?rip|hdcam|hd-?cam|ts|hdts|hd-?ts|telesync|tc|hdtc|hd-?tc|telecine|dvdscr|dvd-?scr|scr|screener|predvd|pre-?dvd|pre-?hd|hq-?s-?print|s-?print|line-?audio)\b/i;
// In URLs only the unmistakable tokens count ("ts" and "tc" are everywhere in paths: segments, hosts).
const THEATER_IN_URL_RE = /(?:^|[/_.-])(camrip|hdcam|hdts|telesync|hdtc|telecine|dvdscr|predvd|pre-dvd|s-print)(?=$|[/_.-])/i;
const HD_PRINT_RE = /\b(hdrip|webrip|web-?dl|webdl|bluray|blu-?ray|brrip|bdrip|hd|hq|1080p|720p|2160p|4k|ott)\b/i;

export type Print = 'original' | 'theater';

export function isTheaterPrint(text: string | undefined): boolean {
  return Boolean(text) && THEATER_PRINT_RE.test(text!);
}

export function isHdPrint(text: string | undefined): boolean {
  return Boolean(text) && !isTheaterPrint(text) && HD_PRINT_RE.test(text!);
}

/** Theatrical when its release name, server name, quality label or address says so; original otherwise. */
export function printOf(s: Pick<ExtractedStream, 'url' | 'quality' | 'serverName' | 'releaseName'>): Print {
  const named = [s.releaseName, s.serverName, s.quality].filter(Boolean).join(' ');
  if (isTheaterPrint(named)) return 'theater';
  let path = s.url ?? '';
  try { path = decodeURIComponent(new URL(path).pathname); } catch { path = path.split('?')[0]; }
  return THEATER_IN_URL_RE.test(path) ? 'theater' : 'original';
}

/**
 * Theatrical prints are dropped when an original print is there: they are neither played nor offered
 * as another language of it.
 */
export function filterBestPrintStreams<T extends Pick<ExtractedStream, 'url' | 'quality' | 'serverName' | 'releaseName'>>(streams: T[]): T[] {
  const originals = streams.filter(s => printOf(s) === 'original');
  return originals.length > 0 ? originals : streams;
}
