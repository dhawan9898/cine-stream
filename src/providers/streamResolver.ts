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
const CACHE_VERSION = 'v6';
// How long a ready stream waits for the (optional) external subtitle lookup.
const SUBTITLE_GRACE_MS = 800;
const keyOf = (p: StreamParams) => `${CACHE_VERSION}|${p.type}|${p.id}|${p.season ?? 0}|${p.episode ?? 0}|${p.languageMode ?? 'sub'}|${p.language ?? ''}|${p.title ?? ''}|${p.preferredServerId ?? ''}`;

function getTitleFallbackUrl(params: StreamParams): string {
  const { id, type, season = 1, episode = 1 } = params;
  if (type === 'tv') {
    return `https://www.2embed.cc/embedtv/${id}?s=${season}&e=${episode}`;
  }
  return `https://www.2embed.cc/embed/${id}`;
}

async function resolveUncached(params: StreamParams): Promise<ResolvedStream> {
  const cacheKey = `stream_${keyOf(params)}`;
  // A retry after a failure must not hand back the same cached (dead) link.
  const persisted = params.fresh ? null : (readPersisted<ResolvedStream>(cacheKey) ?? await readPersistedAsync<ResolvedStream>(cacheKey));
  if (persisted && persisted.url) {
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
      preferredServerId: params.preferredServerId
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
    selectedStream = await extractorRegistry.resolveBestStream(params, allStreams);
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
  } else if (Capacitor.isNativePlatform()) {
    // ExoPlayer only ever receives direct stream data, never an iframe page.
    throw new Error('No working stream was found for this title right now. It may not be available yet - try again in a moment or switch server.');
  } else {
    // Exact TMDB title fallback URL (2embed clean multi-server embed)
    const fallbackUrl = getTitleFallbackUrl(params);
    result = {
      url: fallbackUrl,
      format: 'hls',
      isFallbackEmbed: true,
      serverId: 'multiembed',
      serverName: 'MultiEmbed Server',
      id: params.id,
      type: params.type,
      season: params.season,
      episode: params.episode,
      title: params.title,
      language: params.language,
      availableServers: availableServers.length > 0 ? availableServers : [{ serverId: 'multiembed', serverName: 'MultiEmbed Server', isFallbackEmbed: true }]
    };
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
  const ttlMs = result.isFallbackEmbed ? 30 * 60 * 1000 : 60 * 60 * 1000;
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

export function prefetchStream(params: StreamParams): void {
  resolveStream({ ...params, prefetch: true }).catch(() => {});
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

// Warms the stream cache for titles on screen (e.g. the first home rail) so
// the first tap plays quickly. Runs a couple at a time, only when idle, and
// never uses the web-view sniffer.
const WARM_CONCURRENCY = 2;
const warmQueue: StreamParams[] = [];
const warmSeen = new Set<string>();
let warmActive = 0;

const whenIdle = (fn: () => void) => {
  const w = globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 3000 });
  else setTimeout(fn, 400);
};

function pumpWarmQueue() {
  while (warmActive < WARM_CONCURRENCY && warmQueue.length > 0) {
    const params = warmQueue.shift()!;
    warmActive++;
    resolveStream({ ...params, prefetch: true })
      .catch(() => {})
      .finally(() => { warmActive--; whenIdle(pumpWarmQueue); });
  }
}

export function warmStreams(items: Array<{ id: number; mediaType: MediaType; title: string; language?: string; season?: number; episode?: number }>, limit = 8): void {
  for (const m of items.slice(0, limit)) {
    const params: StreamParams = {
      id: m.id,
      type: m.mediaType,
      title: m.title,
      language: m.language,
      ...(m.mediaType === 'tv' ? { season: m.season ?? 1, episode: m.episode ?? 1 } : {})
    };
    const key = keyOf(params);
    if (warmSeen.has(key)) continue;
    warmSeen.add(key);
    warmQueue.push(params);
  }
  whenIdle(pumpWarmQueue);
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
