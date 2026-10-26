// streamResolver.ts - Resolves a movie/episode to a direct stream (HLS / MP4)
// through the provider extractors. Players never get an embed page: when a
// provider has no direct stream the next one is tried, and when none has,
// resolution fails so the player can say so.
import type { MediaType } from '../core/cineHypeCore.ts';
import { extractorRegistry } from '../extractors/extractorRegistry.ts';
import type { ExtractedStream } from '../extractors/types.ts';

export interface StreamServer {
  id: string;
  name: string;
  badge: string;
  speed: 'Ultra Fast' | 'Fast' | 'Standard';
  description: string;
}

// Only providers with an extractor are listed; ids match the registry.
export const STREAM_SERVERS: StreamServer[] = [
  {
    id: 'vidsrc',
    name: 'VidSrc TO',
    badge: 'Recommended',
    speed: 'Ultra Fast',
    description: 'High-definition mirror with high uptime and multi-audio tracks'
  },
  {
    id: 'autoembed',
    name: 'AutoEmbed CDN',
    badge: 'Global CDN',
    speed: 'Fast',
    description: 'Worldwide CDN with automatic fallback switching'
  }
];

export interface StreamParams {
  id: number;
  type: MediaType;
  season?: number;
  episode?: number;
  // Tried first; the remaining servers follow in list order.
  server?: string;
}

export interface ResolvedStream extends ExtractedStream {
  serverId: string;
  serverName: string;
}

const REUSE_MS = 4 * 60 * 1000;
const cache = new Map<string, { at: number; promise: Promise<ResolvedStream> }>();

const keyOf = (p: StreamParams) => `${p.type}|${p.id}|${p.season ?? 0}|${p.episode ?? 0}|${p.server ?? ''}`;

function serverOrder(preferred?: string): StreamServer[] {
  const first = STREAM_SERVERS.find(s => s.id === preferred);
  return first ? [first, ...STREAM_SERVERS.filter(s => s !== first)] : STREAM_SERVERS;
}

async function resolveUncached(params: StreamParams): Promise<ResolvedStream> {
  for (const server of serverOrder(params.server)) {
    const result = await extractorRegistry.resolveStream(server.id, {
      id: params.id,
      type: params.type,
      season: params.season,
      episode: params.episode
    });
    if (result && result.url) {
      return { ...result, serverId: server.id, serverName: server.name };
    }
  }
  throw new Error('No server returned a playable stream for this title.');
}

/**
 * Resolves a direct stream, shared between the "next episode" prefetch and an
 * explicit play request. Links are time-limited, so a resolved one is only
 * reused briefly; `fresh` skips it (a retry, or a stream that just failed).
 */
export function resolveStream(params: StreamParams, options: { fresh?: boolean } = {}): Promise<ResolvedStream> {
  const key = keyOf(params);
  const existing = cache.get(key);
  if (!options.fresh && existing && Date.now() - existing.at < REUSE_MS) {
    return existing.promise.then(s => ({ ...s }));
  }
  const entry = { at: Date.now(), promise: resolveUncached(params) };
  cache.set(key, entry);
  entry.promise.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  while (cache.size > 8) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return entry.promise.then(s => ({ ...s }));
}
