// streamResolver.ts - Background multi-source stream resolution engine for exact TMDB titles
import { Capacitor } from '@capacitor/core';
import type { MediaType } from './cineHypeCore.ts';
import { readPersisted, readPersistedAsync, writePersisted } from '../services/persistentCache.ts';
import { extractorRegistry } from './extractors/extractorRegistry.ts';
import { fetchSubtitles } from './subtitleService.ts';
import type { ExtractedStream, ExtractorSubtitle } from './extractors/types.ts';

export interface StreamParams {
  id: number;
  type: MediaType;
  season?: number;
  episode?: number;
  languageMode?: string;
  language?: string;
  title?: string;
  preferredServerId?: string;
  // Background prefetch: never launch the web-view sniffer.
  prefetch?: boolean;
  // Retry after a failure: skip remembered-provider shortcuts.
  fresh?: boolean;
  // Providers whose stream just failed to play: not used for this lookup, so a
  // retry goes to a different server instead of the same dead one.
  exclude?: string[];
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

const memoryCache = new Map<string, { at: number; prefetch: boolean; promise: Promise<ResolvedStream> }>();
const REUSE_MS = 30 * 60 * 1000; // 30 minutes in-memory
const CACHE_VERSION = 'v11';
// How long a ready stream waits for the (optional) external subtitle lookup.
const SUBTITLE_GRACE_MS = 40;
const keyOf = (p: StreamParams) => `${CACHE_VERSION}|${p.type}|${p.id}|${p.season ?? 0}|${p.episode ?? 0}|${p.languageMode ?? 'sub'}|${p.language ?? ''}|${p.title ?? ''}|${p.preferredServerId ?? ''}`;

/**
 * Drops the saved stream for a title/episode (memory and disk). Called when it
 * failed to play, so neither a retry nor the next visit is handed the same dead link.
 */
export function forgetStream(params: StreamParams): void {
  const key = keyOf(params);
  memoryCache.delete(key);
  writePersisted(`stream_${key}`, {}, 1);
}

async function resolveUncached(params: StreamParams): Promise<ResolvedStream> {
  const cacheKey = `stream_${keyOf(params)}`;
  // A retry after a failure must not hand back the same cached (dead) link.
  const persisted = params.fresh ? null : (readPersisted<ResolvedStream>(cacheKey) ?? await readPersistedAsync<ResolvedStream>(cacheKey));
  if (persisted && persisted.url && !persisted.isFallbackEmbed) {
    return persisted;
  }

  const subtitlesPromise = fetchSubtitles(params);
  let allStreams: ExtractedStream[] = [];
  try {
    allStreams = await extractorRegistry.resolveAllStreams({
      id: params.id,
      type: params.type,
      season: params.season,
      episode: params.episode,
      title: params.title,
      language: params.language,
      allowSniff: !params.prefetch,
      fresh: params.fresh,
      preferredServerId: params.preferredServerId,
      exclude: params.exclude
    });
  } catch (err) {
    console.warn('[StreamResolver] Extraction resolution error:', err);
  }

  const registered = extractorRegistry.getAllExtractors();
  const serverMap = new Map<string, { serverId: string; serverName: string; isFallbackEmbed?: boolean }>();

  for (const s of allStreams) {
    if (s.serverId) {
      serverMap.set(s.serverId, {
        serverId: s.serverId,
        serverName: s.serverName || s.serverId,
        isFallbackEmbed: s.isFallbackEmbed
      });
    }
  }

  for (const ext of registered) {
    if (!serverMap.has(ext.id)) {
      serverMap.set(ext.id, {
        serverId: ext.id,
        serverName: ext.name,
        isFallbackEmbed: false
      });
    }
  }

  const availableServers = Array.from(serverMap.values());

  let selectedStream: ExtractedStream | null = null;
  try {
    selectedStream = await extractorRegistry.resolveBestStream(params, allStreams);
  } catch {
    selectedStream = null;
  }

  // If a specific preferred server was requested but not yet extracted or selected, resolve it directly
  if (params.preferredServerId && (!selectedStream || selectedStream.serverId !== params.preferredServerId)) {
    const preferredExtractor = registered.find(e => e.id === params.preferredServerId);
    if (preferredExtractor) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 1000);
        const direct = await Promise.race([
          preferredExtractor.extract({ ...params, signal: ctl.signal }),
          new Promise<null>(r => setTimeout(() => r(null), 1000))
        ]).finally(() => clearTimeout(timer));
        // An embed page is never playable: only a direct stream is accepted.
        if (direct && direct.url && !direct.isFallbackEmbed) {
          selectedStream = {
            ...direct,
            serverId: direct.serverId || preferredExtractor.id,
            serverName: direct.serverName || preferredExtractor.name
          };
          if (!allStreams.some(s => s.serverId === selectedStream?.serverId)) {
            allStreams.push(selectedStream);
          }
        }
      } catch (err) {
        console.warn(`[StreamResolver] Direct resolution for ${params.preferredServerId} fallback:`, err);
      }
    }
  }

  let result: ResolvedStream;

  if (selectedStream && selectedStream.url) {
    result = {
      ...selectedStream,
      serverId: selectedStream.serverId,
      serverName: selectedStream.serverName,
      id: params.id,
      type: params.type,
      season: params.season,
      episode: params.episode,
      title: params.title,
      language: params.language,
      availableServers
    };
  } else {
    // Never hand an embed/iframe page to the player.
    throw new Error('No working stream was found for this title right now. It may not be available yet - try again in a moment or switch server.');
  }

  // Subtitles the stream itself carries stay first; external ones are added
  // after. Playback never waits long for them: if the subtitle lookup is slow
  // the stream starts without them, and they are saved with the cached stream
  // as soon as they arrive (so the next play, or a retry, has them).
  const addExternal = (target: ResolvedStream, external: ExtractorSubtitle[]) => {
    if (external.length === 0) return;
    const have = new Set((target.subtitles ?? []).map(t => t.url));
    target.subtitles = [...(target.subtitles ?? []), ...external.filter(t => !have.has(t.url))];
  };
  const early = await Promise.race([
    subtitlesPromise,
    new Promise<null>(r => setTimeout(() => r(null), SUBTITLE_GRACE_MS))
  ]);
  addExternal(result, early ?? []);

  // Persist resolved stream (1 hour for direct - signed links expire, 30 mins for fallback embed)
  const ttlMs = 60 * 60 * 1000;
  writePersisted(cacheKey, result, ttlMs);
  if (early === null) {
    subtitlesPromise.then(late => {
      if (late.length === 0) return;
      const withSubs: ResolvedStream = { ...result, subtitles: [...(result.subtitles ?? [])] };
      addExternal(withSubs, late);
      writePersisted(cacheKey, withSubs, ttlMs);
    }).catch(() => {});
  }

  return result;
}

export function resolveStream(params: StreamParams, options: { fresh?: boolean } = {}): Promise<ResolvedStream> {
  const key = keyOf(params);
  const cacheKey = `stream_${key}`;

  if (!options.fresh) {
    const syncPersisted = readPersisted<ResolvedStream>(cacheKey);
    if (syncPersisted && syncPersisted.url) {
      return Promise.resolve({ ...syncPersisted });
    }

    const existing = memoryCache.get(key);
    if (existing && Date.now() - existing.at < REUSE_MS) {
      // A background prefetch never uses the web-view sniffer, so if it came
      // up empty a real playback request must try again with the full pipeline.
      if (existing.prefetch && !params.prefetch) {
        const retry = existing.promise.catch(() => resolveUncached({ ...params, prefetch: false }));
        const entry = { at: Date.now(), prefetch: false, promise: retry };
        memoryCache.set(key, entry);
        retry.catch(() => { if (memoryCache.get(key) === entry) memoryCache.delete(key); });
        return retry.then(s => ({ ...s }));
      }
      return existing.promise.then(s => ({ ...s }));
    }
  }

  const entry = { at: Date.now(), prefetch: Boolean(params.prefetch), promise: resolveUncached(options.fresh ? { ...params, fresh: true } : params) };
  memoryCache.set(key, entry);
  entry.promise.catch(() => {
    if (memoryCache.get(key) === entry) memoryCache.delete(key);
  });

  return entry.promise.then(s => ({ ...s }));
}

const PREFETCH_CONCURRENCY = 4;
const prefetchQueue: StreamParams[] = [];
const prefetchQueuedKeys = new Set<string>();
let prefetchActive = 0;

function pumpPrefetchQueue() {
  while (prefetchActive < PREFETCH_CONCURRENCY && prefetchQueue.length > 0) {
    const params = prefetchQueue.shift()!;
    prefetchActive++;
    resolveStream({ ...params, prefetch: true })
      .catch(() => {})
      .finally(() => {
        prefetchActive--;
        setTimeout(pumpPrefetchQueue, 10);
      });
  }
}

export function prefetchStream(params: StreamParams, options: { immediate?: boolean } = {}): void {
  const key = keyOf(params);
  const cacheKey = `stream_${key}`;

  // If already persisted or currently in flight, skip re-queueing
  if (readPersisted(cacheKey) || memoryCache.has(key)) {
    return;
  }

  if (options.immediate) {
    resolveStream({ ...params, prefetch: true }).catch(() => {});
    return;
  }

  if (prefetchQueuedKeys.has(key)) return;
  prefetchQueuedKeys.add(key);

  // Unshift so most newly visible/rendered posters get resolved first
  prefetchQueue.unshift(params);
  setTimeout(pumpPrefetchQueue, 0);
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

// Warms the stream cache for titles on screen so first tap plays instantly
export function warmStreams(items: Array<{ id: number; mediaType: MediaType; title: string; language?: string; season?: number; episode?: number }>, limit = 8): void {
  for (const m of items.slice(0, limit)) {
    prefetchStream({
      id: m.id,
      type: m.mediaType,
      title: m.title,
      language: m.language,
      ...(m.mediaType === 'tv' ? { season: m.season ?? 1, episode: m.episode ?? 1 } : {})
    });
  }
}

// While an episode plays, resolve the next few so they start instantly. Uses
// exactly the params playback uses, so the cached result is a direct hit.
export function prefetchUpcomingEpisodes(
  base: Omit<StreamParams, 'episode' | 'prefetch'>,
  currentEpisode: number,
  knownEpisodes: number[],
  count = 2
): void {
  const upcoming = knownEpisodes.filter(n => n > currentEpisode).sort((a, b) => a - b).slice(0, count);
  // One after another, so they never compete with the stream being watched.
  upcoming.reduce<Promise<unknown>>(
    (chain, n) => chain.then(() => resolveStream({ ...base, episode: n, prefetch: true }).catch(() => {})),
    Promise.resolve()
  );
}
