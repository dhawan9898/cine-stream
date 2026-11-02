// streamResolver.ts - Background multi-source stream resolution engine for exact TMDB titles
import type { MediaType } from '../core/cineHypeCore.ts';
import { readPersistedAsync, writePersisted } from '../core/persistentCache.ts';
import { extractorRegistry } from '../extractors/extractorRegistry.ts';
import type { ExtractedStream } from '../extractors/types.ts';

export interface StreamParams {
  id: number;
  type: MediaType;
  season?: number;
  episode?: number;
  languageMode?: string;
  language?: string;
  title?: string;
  preferredServerId?: string;
}

export interface ResolvedStream extends ExtractedStream {
  id: number;
  type: MediaType;
  season?: number;
  episode?: number;
  languageMode?: string;
  language?: string;
  title?: string;
  availableServers?: Array<{ serverId: string; serverName: string; isFallbackEmbed?: boolean }>;
}

const memoryCache = new Map<string, { at: number; promise: Promise<ResolvedStream> }>();
const REUSE_MS = 30 * 60 * 1000; // 30 minutes in-memory
const keyOf = (p: StreamParams) => `${p.type}|${p.id}|${p.season ?? 0}|${p.episode ?? 0}|${p.languageMode ?? 'sub'}|${p.language ?? ''}|${p.title ?? ''}|${p.preferredServerId ?? ''}`;

function getTitleFallbackUrl(params: StreamParams): string {
  const { id, type, season = 1, episode = 1 } = params;
  if (type === 'tv') {
    return `https://vidlink.pro/tv/${id}/${season}/${episode}?primaryColor=ec1c24&autoplay=true`;
  }
  return `https://vidlink.pro/movie/${id}?primaryColor=ec1c24&autoplay=true`;
}

async function resolveUncached(params: StreamParams): Promise<ResolvedStream> {
  const cacheKey = `stream_${keyOf(params)}`;
  const persisted = await readPersistedAsync<ResolvedStream>(cacheKey);
  if (persisted && persisted.url) {
    return persisted;
  }

  let allStreams: ExtractedStream[] = [];
  try {
    allStreams = await extractorRegistry.resolveAllStreams({
      id: params.id,
      type: params.type,
      season: params.season,
      episode: params.episode,
      title: params.title,
      language: params.language
    });
  } catch (err) {
    console.warn('[StreamResolver] Extraction resolution error:', err);
  }

  const availableServers = allStreams.map(s => ({
    serverId: s.serverId || 'unknown',
    serverName: s.serverName || 'Server',
    isFallbackEmbed: s.isFallbackEmbed
  }));

  let selectedStream: ExtractedStream | null = null;
  try {
    selectedStream = await extractorRegistry.resolveBestStream(params);
  } catch {
    selectedStream = null;
  }

  let result: ResolvedStream;

  if (selectedStream && selectedStream.url) {
    result = {
      ...selectedStream,
      id: params.id,
      type: params.type,
      season: params.season,
      episode: params.episode,
      title: params.title,
      language: params.language,
      availableServers
    };
  } else {
    // Exact TMDB title fallback URL
    const fallbackUrl = getTitleFallbackUrl(params);
    result = {
      url: fallbackUrl,
      format: 'hls',
      isFallbackEmbed: true,
      serverId: 'vidlink',
      serverName: 'VidLink PRO',
      id: params.id,
      type: params.type,
      season: params.season,
      episode: params.episode,
      title: params.title,
      language: params.language,
      availableServers: availableServers.length > 0 ? availableServers : [{ serverId: 'vidlink', serverName: 'VidLink PRO', isFallbackEmbed: true }]
    };
  }

  // Persist resolved stream (2 hours for direct, 45 mins for fallback embed)
  const ttlMs = result.isFallbackEmbed ? 45 * 60 * 1000 : 120 * 60 * 1000;
  writePersisted(cacheKey, result, ttlMs);

  return result;
}

export function resolveStream(params: StreamParams, options: { fresh?: boolean } = {}): Promise<ResolvedStream> {
  const key = keyOf(params);
  const existing = memoryCache.get(key);
  if (!options.fresh && existing && Date.now() - existing.at < REUSE_MS) {
    return existing.promise.then(s => ({ ...s }));
  }

  const entry = { at: Date.now(), promise: resolveUncached(params) };
  memoryCache.set(key, entry);
  entry.promise.catch(() => {
    if (memoryCache.get(key) === entry) memoryCache.delete(key);
  });

  return entry.promise.then(s => ({ ...s }));
}

export function prefetchStream(params: StreamParams): void {
  resolveStream(params).catch(() => {});
}

export async function resolveAllAvailableStreams(params: StreamParams): Promise<ResolvedStream[]> {
  const extractedList = await extractorRegistry.resolveAllStreams({
    id: params.id,
    type: params.type,
    season: params.season,
    episode: params.episode,
    title: params.title,
    language: params.language
  });

  return extractedList.map(s => ({
    ...s,
    id: params.id,
    type: params.type,
    season: params.season,
    episode: params.episode,
    title: params.title,
    language: params.language
  }));
}
