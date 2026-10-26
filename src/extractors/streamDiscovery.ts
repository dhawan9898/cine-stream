// streamDiscovery.ts - Finds playable streams in whatever a provider returns:
// HTML pages, JSON (any shape), JavaScript, escaped/encoded/base64 text, or a
// playlist/manifest itself. Pure functions; no network access here.
import type { ExtractorSubtitle, StreamFormat } from './types.ts';

export interface FoundStream {
  url: string;
  format: StreamFormat;
  quality?: string;
}

export interface Discovery {
  streams: FoundStream[];
  subtitles: ExtractorSubtitle[];
  // Pages to look at next (iframes, embed links, API urls).
  pages: string[];
}

const MEDIA_RE = /https?:(?:\\?\/){2}[^\s"'<>\\)\]},;]+?\.(?:m3u8|mpd|mp4|webm|mkv)(?:\?[^\s"'<>\\)\]},;]*)?/gi;
const SUB_RE = /https?:(?:\\?\/){2}[^\s"'<>\\)\]},;]+?\.(?:vtt|srt|ass|ssa)(?:\?[^\s"'<>\\)\]},;]*)?/gi;
const FRAME_RE = /<(?:iframe|source|video)\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
const DATA_SRC_RE = /\bdata-(?:src|url|embed|link|hash)\s*=\s*["']([^"']+)["']/gi;
const EMBED_KEY_RE = /["'](?:embed_url|embedUrl|iframe|iframe_url|player_url|playerUrl|link|redirect)["']\s*:\s*["']([^"']+)["']/gi;
const B64_RE = /atob\(\s*["']([A-Za-z0-9+/=_-]{16,})["']\s*\)/g;

export function formatOf(url: string): StreamFormat {
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.mpd')) return 'dash';
  if (path.endsWith('.m3u8')) return 'hls';
  if (/\.(mp4|webm|mkv)$/.test(path)) return 'mp4';
  return 'hls';
}

/** Undoes the escaping providers hide URLs behind (JSON `\/`, `&`, `&amp;`, %-encoding). */
export function unescapeText(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
}

function tryBase64(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized);
    return /^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function absolutize(url: string, base: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || /^(javascript|data|blob|about|mailto):/i.test(trimmed)) return null;
  try {
    return new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed, base).toString();
  } catch {
    return null;
  }
}

function qualityOf(url: string, hint?: string): string | undefined {
  const m = (hint ?? '').match(/(\d{3,4})\s*p?/) ?? url.match(/[/_.-](2160|1440|1080|720|480|360|240)p?(?=[/_.\-?]|$)/);
  return m ? `${m[1]}p` : undefined;
}

function* walkJson(node: unknown, key = ''): Generator<[string, unknown]> {
  yield [key, node];
  if (Array.isArray(node)) {
    for (const item of node) yield* walkJson(item, key);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) yield* walkJson(v, k);
  }
}

const SUB_KEYS = /^(subtitles?|captions?|tracks?|subs)$/i;

/** Pulls streams, subtitles and follow-up pages out of one response body. */
export function discover(body: string, baseUrl: string): Discovery {
  const streams = new Map<string, FoundStream>();
  const subtitles = new Map<string, ExtractorSubtitle>();
  const pages = new Set<string>();

  const addStream = (raw: string, hint?: string, format?: StreamFormat) => {
    const url = absolutize(unescapeText(raw), baseUrl);
    if (!url) return;
    if (!streams.has(url)) streams.set(url, { url, format: format ?? formatOf(url), quality: qualityOf(url, hint) });
  };
  const addSub = (raw: string, label?: string, lang?: string) => {
    const url = absolutize(unescapeText(raw), baseUrl);
    if (!url || subtitles.has(url)) return;
    const l = lang || label || 'und';
    subtitles.set(url, { url, lang: l, label: label || l, mimeType: /\.srt/i.test(url) ? 'application/x-subrip' : 'text/vtt' });
  };
  const addPage = (raw: string) => {
    const url = absolutize(unescapeText(raw), baseUrl);
    if (url && /^https?:/i.test(url)) pages.add(url);
  };

  const scan = (text: string) => {
    for (const m of text.matchAll(MEDIA_RE)) addStream(m[0]);
    for (const m of text.matchAll(SUB_RE)) addSub(m[0]);
    for (const m of text.matchAll(FRAME_RE)) {
      if (/\.(m3u8|mpd|mp4|webm|mkv)(\?|$)/i.test(m[1])) addStream(m[1]); else addPage(m[1]);
    }
    for (const m of text.matchAll(DATA_SRC_RE)) if (/^(https?:)?\/\//i.test(m[1]) || m[1].startsWith('/')) addPage(m[1]);
    for (const m of text.matchAll(EMBED_KEY_RE)) addPage(m[1]);
  };

  const text = body.trim();

  // The response is itself a manifest.
  if (text.startsWith('#EXTM3U')) addStream(baseUrl, undefined, 'hls');
  else if (/^<\?xml[\s\S]*<MPD\b/i.test(text) || text.startsWith('<MPD')) addStream(baseUrl, undefined, 'dash');

  // JSON of any shape: look at every string, and at track-like objects for labels.
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      for (const [key, value] of walkJson(JSON.parse(text))) {
        if (typeof value === 'string') {
          const v = unescapeText(value);
          if (/\.(m3u8|mpd|mp4|webm|mkv)(\?|$)/i.test(v)) addStream(v, key);
          else if (/\.(vtt|srt|ass|ssa)(\?|$)/i.test(v)) addSub(v);
          else if (/^(https?:)?\/\//i.test(v) && /^(embed_?url|iframe|player_?url|link|redirect|url|file|src)$/i.test(key)) addPage(v);
          else if (/^[A-Za-z0-9+/=_-]{24,}$/.test(v)) {
            const dec = tryBase64(v);
            if (dec) scan(dec);
          }
        } else if (SUB_KEYS.test(key) && Array.isArray(value)) {
          for (const t of value) {
            if (t && typeof t === 'object') {
              const o = t as Record<string, unknown>;
              const u = o.file ?? o.url ?? o.src ?? o.link;
              if (typeof u === 'string') addSub(u, String(o.label ?? o.name ?? ''), String(o.lang ?? o.language ?? o.srclang ?? ''));
            }
          }
        }
      }
    } catch { /* not JSON after all; fall through to text scanning */ }
  }

  const unescaped = unescapeText(text);
  scan(unescaped);
  try { scan(decodeURIComponent(unescaped)); } catch { /* malformed escapes */ }
  for (const m of unescaped.matchAll(B64_RE)) {
    const dec = tryBase64(m[1]);
    if (dec) scan(unescapeText(dec));
  }

  return { streams: [...streams.values()], subtitles: [...subtitles.values()], pages: [...pages] };
}

const FORMAT_RANK: Record<StreamFormat, number> = { hls: 3, dash: 2, mp4: 1 };

/** Best candidate: playlists/manifests first, then the highest named quality. */
export function pickBest(streams: FoundStream[]): FoundStream | null {
  if (streams.length === 0) return null;
  const score = (s: FoundStream) =>
    FORMAT_RANK[s.format] * 10000 + (parseInt(s.quality ?? '0', 10) || 0) + (/master|index|playlist/i.test(s.url) ? 1 : 0);
  return [...streams].sort((a, b) => score(b) - score(a))[0];
}
