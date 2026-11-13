// kunaiCommon.ts - Small helpers shared by the extractors ported from Kunai (github.com/KitsuneKode/kunai, MIT).
import type { ExtractorSubtitle, StreamFormat } from './types.ts';

export const KUNAI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** The first promise to give a non-null value wins; null only when every one gave null or failed. */
export function firstSuccess<T>(tasks: Promise<T | null>[]): Promise<T | null> {
  return new Promise(resolve => {
    let left = tasks.length;
    if (left === 0) return resolve(null);
    for (const t of tasks) {
      t.then(v => { if (v != null) resolve(v); }, () => undefined).finally(() => { if (--left === 0) resolve(null); });
    }
  });
}

export function formatOf(url: string, hint?: string): StreamFormat {
  const h = (hint ?? '').toLowerCase();
  const u = url.toLowerCase();
  if (h === 'dash' || /\.mpd(?:[?#]|$)/.test(u)) return 'dash';
  if (h === 'hls' || /\.m3u8(?:[?#]|$)/.test(u) || u.includes('type=hls')) return 'hls';
  if (h === 'mp4' || h === 'file' || /\.mp4(?:[?#]|$)/.test(u)) return 'mp4';
  return 'hls';
}

export function toSubtitles(list: { url?: string; file?: string; lang?: string; language?: string; label?: string }[] | undefined): ExtractorSubtitle[] {
  const out: ExtractorSubtitle[] = [];
  for (const s of list ?? []) {
    const url = s.url || s.file;
    if (!url || !/^https?:/.test(url)) continue;
    const lang = s.lang || s.language || 'und';
    out.push({ url, lang, label: s.label || lang });
  }
  return out;
}

export function qualityRank(q: string | undefined): number {
  const n = parseInt(String(q ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export function base64UrlToBytes(payload: string): Uint8Array {
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 2 ? '==' : b64.length % 4 === 3 ? '=' : '';
  return Uint8Array.from(atob(b64 + pad), c => c.charCodeAt(0));
}

/** After the provider answers 429 (or is otherwise refusing us), stay away from it for a while instead of retrying every title. */
export class Cooldown {
  private until = 0;
  get active(): boolean { return Date.now() < this.until; }
  trip(ms: number) { this.until = Date.now() + ms; }
  /** Trips on a rate-limit error; returns whether it was one. */
  noteError(e: unknown, ms = 60_000): boolean {
    if (e instanceof Error && /HTTP 429\b/.test(e.message)) { this.trip(ms); return true; }
    return false;
  }
}
