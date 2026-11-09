// streamResolver.ts - Background multi-source stream resolution engine for exact TMDB titles
import { Capacitor } from '@capacitor/core';
import type { MediaType } from './cineHypeCore.ts';
import { readPersisted, readPersistedAsync, writePersisted } from '../services/persistentCache.ts';
import { extractorRegistry } from './extractors/extractorRegistry.ts';
import { fetchSubtitles } from './subtitleService.ts';
import type { ExtractedStream, ExtractorSubtitle } from './extractors/types.ts';
import { Priority, StreamScheduler } from './streamScheduler.ts';

export { Priority };

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
const SUBTITLE_GRACE_MS = 300;
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
        const timer = setTimeout(() => ctl.abort(), 6000);
        const direct = await Promise.race([
          preferredExtractor.extract({ ...params, signal: ctl.signal }),
          new Promise<null>(r => setTimeout(() => r(null), 6000))
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

  // Persist resolved stream (signed links expire, so only for an hour)
  const ttlMs = 60 * 60 * 1000;
  writePersisted(cacheKey, result, ttlMs);

  // Every other direct stream the lookup found is saved too, under its own server,
  // so switching server later (or a failover) starts from the cache.
  for (const other of allStreams) {
    if (!other.serverId || other.isFallbackEmbed || !other.url) continue;
    const otherParams: StreamParams = { ...params, preferredServerId: other.serverId, prefetch: undefined, fresh: undefined, exclude: undefined };
    const otherKey = `stream_${keyOf(otherParams)}`;
    if (otherKey === cacheKey) continue;
    const copy: ResolvedStream = {
      ...other,
      id: params.id, type: params.type, season: params.season, episode: params.episode,
      title: params.title, language: params.language, availableServers,
      subtitles: result.subtitles ? [...result.subtitles] : other.subtitles
    };
    writePersisted(otherKey, copy, ttlMs);
  }
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

  // The user asked for this very lookup: it must not also wait in the background queue.
  if (!params.prefetch) scheduler.cancel(key);

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
  // A lookup the user is waiting on: background prefetching yields to it.
  if (!params.prefetch) scheduler.trackUrgent(entry.promise);

  return entry.promise.then(s => ({ ...s }));
}

// Background lookups wait here, most important first (see streamScheduler.ts).
const scheduler = new StreamScheduler<StreamParams>(params => resolveStream({ ...params, prefetch: true }), { concurrency: 2 });

/** True when a usable stream for these params is already saved or being resolved. */
function isResolved(params: StreamParams): boolean {
  const key = keyOf(params);
  return Boolean(readPersisted<ResolvedStream>(`stream_${key}`)?.url) || memoryCache.has(key);
}

/**
 * Resolves a stream in the background, in priority order. Lower `priority` runs
 * first (see Priority); asking again for a queued title with a better priority
 * promotes it. Never launches the web-view sniffer.
 */
export function prefetchStream(params: StreamParams, options: { priority?: number } = {}): void {
  if (isResolved(params)) return;
  const priority = options.priority ?? Priority.POSTER;
  if (priority <= Priority.PLAYBACK) {
    resolveStream({ ...params, prefetch: true }).catch(() => {});
    return;
  }
  scheduler.enqueue(keyOf(params), params, priority);
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
export function warmStreams(
  items: Array<{ id: number; mediaType: MediaType; title: string; language?: string; season?: number; episode?: number }>,
  limit = 8,
  priority: number = Priority.RAIL
): void {
  items.slice(0, limit).forEach(m => {
    prefetchStream({
      id: m.id,
      type: m.mediaType,
      title: m.title,
      language: m.language,
      ...(m.mediaType === 'tv' ? { season: m.season ?? 1, episode: m.episode ?? 1 } : {})
    }, { priority });
  });
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
  // Next episode first (FIFO among equal priority), ahead of every poster prefetch.
  upcoming.forEach(n => prefetchStream({ ...base, episode: n }, { priority: Priority.NEXT_EPISODE }));
}
