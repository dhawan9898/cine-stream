// decryptApi.ts - Turns a FlixHQ-family embed (Vidcloud / UpCloud / Megacloud) into a direct stream through
// a third-party decrypt service, the way lobster does it:
//   POST <endpoint>  { "url": <embed link>, "mediaId": <site watch path> }  ->  JSON with sources[].file (.m3u8)
//                                                                               and tracks[] { file, label }
// That service sees every link asked for, so it only runs when the viewer turned it on (Settings), and the
// remote config can repoint it or switch it off. Each endpoint that fails sits out a few minutes; when none
// answers, the embed is left to the native sniffer (the registry sniffs embed links itself).
import type { ExtractedStream, ExtractorSubtitle } from '../extractors/types.ts';
import { getResolverOverride } from '../providerConfig.ts';
import { getUserPreferences } from '../../services/historyService.ts';

export const DECRYPT_RESOLVER_ID = 'decrypt-api';
export const DEFAULT_DECRYPT_ENDPOINTS = ['https://dec.eatmynerds.live', 'https://decrypt.broggl.farm'];
const ENDPOINT_COOLDOWN_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 5000;

type Post = (url: string, body: unknown, signal?: AbortSignal, timeoutMs?: number) => Promise<string>;

const downUntil = new Map<string, number>();

/** The viewer opted in, and the remote config has not switched it off. */
export function decryptApiEnabled(): boolean {
  if (getResolverOverride(DECRYPT_RESOLVER_ID)?.enabled === false) return false;
  try { return getUserPreferences().flixhqDecryptApi === true; } catch { return false; }
}

export function decryptEndpoints(): string[] {
  return getResolverOverride(DECRYPT_RESOLVER_ID)?.endpoints ?? DEFAULT_DECRYPT_ENDPOINTS;
}

/** The stream (and caption files) in a decrypt service's answer; it is searched, not assumed to have one shape. */
export function parseDecryptAnswer(text: string): { url: string; subtitles: ExtractorSubtitle[] } | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  let url: string | undefined;
  const subtitles: ExtractorSubtitle[] = [];
  const seen = new Set<string>();
  // `under`: the key the node was found under ("tracks", "subtitles", ...).
  const walk = (node: unknown, depth: number, under = '') => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => walk(n, depth + 1, under)); return; }
    const o = node as Record<string, unknown>;
    const file = typeof o.file === 'string' ? o.file : typeof o.url === 'string' ? o.url : undefined;
    if (file && /^https?:\/\//.test(file)) {
      const kind = String(o.kind ?? o.type ?? '').toLowerCase();
      // Thumbnail sprites are .vtt files too: only captions, or an untyped subtitle file listed with
      // captions / under a subtitle key.
      const isCaption = kind === 'captions' || kind === 'subtitles'
        || (!kind && (o.label !== undefined || /sub|caption/.test(under)) && /\.(vtt|srt)(\?|$)/i.test(file));
      if (kind === 'thumbnails' || kind === 'chapters') {
        // not a stream, not a caption
      } else if (isCaption && !seen.has(file)) {
        seen.add(file);
        const label = String(o.label ?? o.lang ?? 'Unknown');
        subtitles.push({ url: file, label, lang: label.slice(0, 2).toLowerCase() });
      } else if (!url && /\.m3u8(\?|$)/i.test(file)) {
        url = file;
      }
    }
    Object.entries(o).forEach(([k, v]) => walk(v, depth + 1, k.toLowerCase()));
  };
  walk(data, 0);
  return url ? { url, subtitles } : null;
}

/**
 * Asks the endpoints in turn. Resolves the direct stream, or null when the resolver is off or nothing
 * answered (then the caller hands the embed to the sniffer).
 */
export async function resolveViaDecryptApi(
  embedUrl: string,
  mediaId: string,
  post: Post,
  signal?: AbortSignal
): Promise<ExtractedStream | null> {
  if (!decryptApiEnabled()) return null;
  for (const endpoint of decryptEndpoints()) {
    if (signal?.aborted) return null;
    if ((downUntil.get(endpoint) ?? 0) > Date.now()) continue;
    try {
      const found = parseDecryptAnswer(await post(endpoint, { url: embedUrl, mediaId }, signal, TIMEOUT_MS));
      if (!found) { downUntil.set(endpoint, Date.now() + ENDPOINT_COOLDOWN_MS); continue; }
      const origin = (() => { try { return new URL(embedUrl).origin; } catch { return ''; } })();
      return {
        url: found.url,
        format: 'hls',
        // The embed host's CDN checks where the request comes from.
        headers: origin ? { Referer: `${origin}/`, Origin: origin } : undefined,
        subtitles: found.subtitles
      };
    } catch {
      if (signal?.aborted) return null;
      downUntil.set(endpoint, Date.now() + ENDPOINT_COOLDOWN_MS);
    }
  }
  return null;
}

/** Tests: forget which endpoints were marked down. */
export function resetDecryptEndpoints(): void { downUntil.clear(); }
