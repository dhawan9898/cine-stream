// printClassifier.ts - Classifies release print quality (Theater/CAM vs HD/Retail)
// Automatically filters out Theater prints (CAM, HDCAM, DVDScr, PreDVD, TC) when HD prints (HDRip, WEBRip, WEB-DL, BluRay) exist.
import type { ExtractedStream } from './types.ts';

const THEATER_PRINT_RE = /\b(cam|hdcam|dvdscr|predvd|telecine|tc|scr|camrip)\b/i;
const HD_PRINT_RE = /\b(hdrip|webrip|web-dl|webdl|bluray|hd|bdrip|hq|1080p|720p|2160p|4k)\b/i;

export function isTheaterPrint(text: string | undefined): boolean {
  if (!text) return false;
  return THEATER_PRINT_RE.test(text);
}

export function isHdPrint(text: string | undefined): boolean {
  if (!text) return false;
  return HD_PRINT_RE.test(text);
}

/**
 * Given a list of extracted streams, filters out Theater/CAM prints if at least one HD/Retail print stream exists.
 */
export function filterBestPrintStreams(streams: ExtractedStream[]): ExtractedStream[] {
  if (streams.length <= 1) return streams;

  const hasHd = streams.some(s => {
    const info = `${s.serverName ?? ''} ${s.quality ?? ''} ${s.url}`;
    return isHdPrint(info) || (!isTheaterPrint(info) && (s.height ?? 0) >= 720);
  });

  if (!hasHd) return streams;

  const filtered = streams.filter(s => {
    const info = `${s.serverName ?? ''} ${s.quality ?? ''} ${s.url}`;
    return !isTheaterPrint(info);
  });

  return filtered.length > 0 ? filtered : streams;
}
