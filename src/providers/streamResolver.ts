// streamResolver.ts - Background multi-source stream resolution engine for exact TMDB titles
import { Capacitor } from '@capacitor/core';
import type { MediaType } from './cineHypeCore.ts';
import {
  getLiveStream, getStreamRecord, markStreamChecked, markStreamDead, putStream, streamStoreReady, updateStreamValue, type StreamRecord
} from './streamStore.ts';
import { extractorRegistry } from './extractors/extractorRegistry.ts';
import { fetchSubtitles } from './subtitleService.ts';
import type { AlternateStream, ExtractedStream, ExtractorSubtitle } from './extractors/types.ts';
import { Priority, StreamScheduler } from './streamScheduler.ts';
import { recordTiming } from './streamTimings.ts';
import { checkLink } from './streamRevalidator.ts';
import { speculationAllowed } from './speculation.ts';

export { Priority };

export interface StreamParams {
  id: number;
  type: MediaType;
  season?: number;
  episode?: number;
  languageMode?: string;
  language?: string;
  title?: string;
  // For search-based sources (FlixHQ, Jellyfin): a second search key and the year, to match the right title.
  originalTitle?: string;
  year?: number;
  preferredServerId?: string;
  // Background prefetch: never launch the web-view sniffer, unless `speculative`.
  prefetch?: boolean;
  // A likely-next title (Continue Watching, next episode, hero): the sniffer may run in the
  // background, yielding to anything the user does (see speculation.ts).
  speculative?: boolean;
  // Retry after a failure: skip remembered-provider shortcuts.
  fresh?: boolean;
  // Providers whose stream just failed to play: not used for this lookup, so a
  // retry goes to a different server instead of the same dead one.
  exclude?: string[];
  // The next episode of what is playing: its background lookup may sniff while the player is open.
  nextEpisode?: boolean;
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
  /** Other working streams for the same title, best first: the player fails over to them itself. */
  alternates?: AlternateStream[];
}

// Alternates handed to the player at most.
const MAX_ALTERNATES = 4;

/**
 * Up to MAX_ALTERNATES other direct streams, best first, other servers before other lanes of the same one
 * (a dead server usually takes all its lanes with it).
 */
export function pickAlternates(chosen: ExtractedStream, all: ExtractedStream[]): AlternateStream[] {
  const seen = new Set([chosen.url]);
  const candidates = all.filter(s => s.url && !s.isFallbackEmbed && !seen.has(s.url) && (seen.add(s.url), true));
  const otherServers = candidates.filter(s => s.serverId !== chosen.serverId);
  const sameServer = candidates.filter(s => s.serverId === chosen.serverId);
  return [...otherServers, ...sameServer].slice(0, MAX_ALTERNATES).map(s => ({
    url: s.url, format: s.format, headers: s.headers, serverId: s.serverId, serverName: s.serverName
  }));
}

// One in-flight or recent lookup per key, shared by everyone who asks for it. A lookup is
// cancelled (its sniffers and requests freed) once every caller that passed a signal has
// gone and nobody without one (a prefetch) is relying on it.
interface MemoryEntry {
  at: number;
  prefetch: boolean;
  speculative?: boolean;
  promise: Promise<ResolvedStream>;
  ctl: AbortController;
  holders: number;
  pinned: boolean;
  settled: boolean;
}
const memoryCache = new Map<string, MemoryEntry>();
const REUSE_MS = 30 * 60 * 1000; // 30 minutes in-memory
// Settled lookups kept in memory at most (the persistent store has the rest).
const MEMORY_MAX = 150;
// A caller that leaves and comes straight back (an effect re-running) keeps the same lookup.
const RELEASE_GRACE_MS = 300;

const abortError = () => {
  const err = new Error('Stream lookup cancelled');
  err.name = 'AbortError';
  return err;
};

function pruneMemoryCache(now = Date.now()): void {
  for (const [k, e] of memoryCache) {
    if (e.settled && now - e.at > REUSE_MS) memoryCache.delete(k);
  }
  if (memoryCache.size > MEMORY_MAX) {
    // Map iteration is insertion order: oldest first. Lookups still running are kept.
    for (const [k, e] of memoryCache) {
      if (memoryCache.size <= MEMORY_MAX) break;
      if (e.settled) memoryCache.delete(k);
    }
  }
  for (const [k, until] of negative) {
    if (until <= now) negative.delete(k);
  }
}

function startEntry(key: string, flags: { prefetch: boolean; speculative?: boolean }, run: (signal: AbortSignal) => Promise<ResolvedStream>): MemoryEntry {
  const ctl = new AbortController();
  const entry: MemoryEntry = { at: Date.now(), ...flags, ctl, holders: 0, pinned: false, settled: false, promise: run(ctl.signal) };
  entry.promise.then(
    () => { entry.settled = true; },
    () => { entry.settled = true; if (memoryCache.get(key) === entry) memoryCache.delete(key); }
  );
  memoryCache.set(key, entry);
  pruneMemoryCache();
  return entry;
}

/** Hands `entry`'s result to one caller; `signal` lets that caller leave (see MemoryEntry). */
function attach(key: string, entry: MemoryEntry, signal?: AbortSignal): Promise<ResolvedStream> {
  if (!signal) {
    entry.pinned = true;
    return entry.promise.then(s => ({ ...s }));
  }
  if (signal.aborted) return Promise.reject(abortError());
  entry.holders++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.holders--;
  };
  return new Promise<ResolvedStream>((resolve, reject) => {
    const onAbort = () => {
      reject(abortError());
      setTimeout(() => {
        release();
        if (entry.holders <= 0 && !entry.pinned && !entry.settled) {
          entry.ctl.abort();
          if (memoryCache.get(key) === entry) memoryCache.delete(key);
        }
      }, RELEASE_GRACE_MS);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    entry.promise.then(
      s => { signal.removeEventListener('abort', onAbort); release(); resolve({ ...s }); },
      e => { signal.removeEventListener('abort', onAbort); release(); reject(e); }
    );
  });
}
const CACHE_VERSION = 'v11';
// How long a ready stream waits for the (optional) external subtitle lookup.
const SUBTITLE_GRACE_MS = 300;
const keyOf = (p: StreamParams) => `${CACHE_VERSION}|${p.type}|${p.id}|${p.season ?? 0}|${p.episode ?? 0}|${p.languageMode ?? 'sub'}|${p.language ?? ''}|${p.title ?? ''}|${p.preferredServerId ?? ''}`;

/**
 * Flags the saved stream for a title/episode as dead (memory and disk). Called when it
 * failed to play, so neither a retry nor the next visit is handed the same dead link.
 */
export function forgetStream(params: StreamParams): void {
  const key = keyOf(params);
  memoryCache.delete(key);
  // Kept (flagged dead) rather than deleted: the next lookup replaces it.
  markStreamDead(key);
}

// The part of the params a later lookup needs (no flags), kept with the saved stream.
function paramsForStore(p: StreamParams): Record<string, unknown> {
  const { prefetch: _prefetch, fresh: _fresh, exclude: _exclude, nextEpisode: _next, ...rest } = p;
  return rest;
}

// Tries saved embed pages with the sniffer, a couple at most. Native only; a no-op elsewhere.
async function reviveFromEmbeds(_params: StreamParams, embeds: ExtractedStream[], backgroundOnly?: boolean): Promise<ExtractedStream | null> {
  if (backgroundOnly || !Capacitor.isNativePlatform()) return null;
  for (const embed of embeds.slice(0, 2)) {
    const stream = await extractorRegistry.sniffEmbed(embed).catch(() => null);
    if (stream && stream.url) return { ...stream, serverId: embed.serverId, serverName: embed.serverName };
  }
  return null;
}

// Times the whole lookup, from request to a stream the player can use.
async function resolveUncached(params: StreamParams, signal?: AbortSignal): Promise<ResolvedStream> {
  const startedAt = Date.now();
  const hit = { cached: false };
  const note = (outcome: 'ok' | 'fail' | 'cache', serverId?: string) => recordTiming({
    phase: 'lookup', ms: Date.now() - startedAt, outcome, serverId, titleId: params.id, title: params.title, background: Boolean(params.prefetch)
  });
  try {
    const result = await resolveUncachedInner(params, hit, signal);
    negative.delete(keyOf(params));
    note(hit.cached ? 'cache' : 'ok', result.serverId);
    return result;
  } catch (err) {
    // Nobody wanted it any more: that says nothing about the title or its providers.
    if (signal?.aborted) throw abortError();
    note('fail');
    negative.set(keyOf(params), Date.now() + NEGATIVE_MS);
    throw err;
  }
}

async function resolveUncachedInner(params: StreamParams, hit: { cached: boolean }, signal?: AbortSignal): Promise<ResolvedStream> {
  const cacheKey = keyOf(params);
  await streamStoreReady;
  // A retry after a failure must not hand back the same cached (dead) link.
  const persisted = params.fresh ? null : getLiveStream<ResolvedStream>(cacheKey);
  if (persisted && persisted.url && !persisted.isFallbackEmbed) {
    hit.cached = true;
    return persisted;
  }
  const lookupStartedAt = Date.now();
  const savedEmbeds = getStreamRecord(cacheKey)?.embeds ?? [];
  const foundEmbeds: ExtractedStream[] = [];

  const subtitlesPromise = fetchSubtitles(params);
  let allStreams: ExtractedStream[] = [];
  try {
    allStreams = await extractorRegistry.resolveAllStreams({
      id: params.id,
      type: params.type,
      season: params.season,
      episode: params.episode,
      title: params.title,
      originalTitle: params.originalTitle,
      year: params.year,
      language: params.language,
      allowSniff: !params.prefetch || Boolean(params.speculative),
      sniffBackground: Boolean(params.prefetch),
      fresh: params.fresh,
      preferredServerId: params.preferredServerId,
      exclude: params.exclude,
      signal,
      onEmbed: embed => { if (!foundEmbeds.some(e => e.url === embed.url)) foundEmbeds.push(embed); }
    });
  } catch (err) {
    console.warn('[StreamResolver] Extraction resolution error:', err);
  }

  if (signal?.aborted) throw abortError();

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
        const onAbort = () => ctl.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const direct = await Promise.race([
          preferredExtractor.extract({ ...params, signal: ctl.signal }),
          new Promise<null>(r => { timer = setTimeout(() => { ctl.abort(); r(null); }, 6000); })
        ]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); });
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
    // Embed pages saved by earlier lookups can still be turned into a direct stream
    // by the native sniffer (a hidden web view; the embed itself is never played).
    // The providers already had their whole deadline (and sniffed these same pages): past a certain
    // point another round of sniffing only makes the person wait longer for the same "no stream".
    const spentMs = Date.now() - lookupStartedAt;
    if (signal?.aborted) throw abortError();
    const revived = spentMs > REVIVE_BUDGET_MS ? null : await reviveFromEmbeds(params, [...foundEmbeds, ...savedEmbeds], params.prefetch);
    if (revived) {
      allStreams.push(revived);
      result = {
        ...revived,
        id: params.id, type: params.type, season: params.season, episode: params.episode,
        title: params.title, language: params.language, availableServers
      };
    } else {
    // Never hand an embed/iframe page to the player.
    throw new Error('No working stream was found for this title right now. It may not be available yet - try again in a moment.');
    }
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

  const alternates = pickAlternates(result, allStreams);
  if (alternates.length > 0) result.alternates = alternates;

  // Saved permanently: it is only replaced by a newer lookup, or flagged dead when it stops
  // working (see streamStore / streamRevalidator). Embed pages found on the way are kept too.
  const uniqueEmbeds = [...foundEmbeds, ...savedEmbeds].filter((e, i, a) => a.findIndex(x => x.url === e.url) === i);
  putStream(cacheKey, result, uniqueEmbeds, paramsForStore(params));

  // Every other direct stream the lookup found is saved too, under its own server,
  // so switching server later (or a failover) starts from the cache.
  for (const other of allStreams) {
    if (!other.serverId || other.isFallbackEmbed || !other.url) continue;
    const otherParams: StreamParams = { ...params, preferredServerId: other.serverId, prefetch: undefined, fresh: undefined, exclude: undefined };
    const otherKey = keyOf(otherParams);
    if (otherKey === cacheKey) continue;
    const copy: ResolvedStream = {
      ...other,
      alternates: pickAlternates(other, allStreams),
      id: params.id, type: params.type, season: params.season, episode: params.episode,
      title: params.title, language: params.language, availableServers,
      subtitles: result.subtitles ? [...result.subtitles] : other.subtitles
    };
    putStream(otherKey, copy, [], paramsForStore(otherParams));
  }
  if (early === null) {
    subtitlesPromise.then(late => {
      if (late.length === 0) return;
      const withSubs: ResolvedStream = { ...result, subtitles: [...(result.subtitles ?? [])] };
      addExternal(withSubs, late);
      updateStreamValue(cacheKey, withSubs);
    }).catch(() => {});
  }

  return result;
}

// Titles every provider failed for a moment ago: background prefetching leaves them alone for a
// while instead of rerunning a full failing lookup. (A user's own Play always tries.)
const NEGATIVE_MS = 60_000;
const negative = new Map<string, number>();
const isNegative = (key: string) => (negative.get(key) ?? 0) > Date.now();

// Sniffing saved embed pages after a failed lookup is skipped when the lookup already took this long.
const REVIVE_BUDGET_MS = 8_000;

// A saved link that was last confirmed longer ago than this is checked before it reaches the player.
const VALIDATE_AFTER_MS = 15 * 60 * 1000;
// ...but the check never holds playback up for longer than this.
const VALIDATE_CAP_MS = 600;
// Saved alternatives (other servers) checked at once when the saved link is dead, and their cap.
const ALT_CHECK_MAX = 3;
const ALT_CHECK_CAP_MS = 1500;

/**
 * Confirms a saved stream still answers. If not, it is flagged dead and the next best saved
 * server for the same title is used - no new lookup. Resolves null when nothing saved is usable.
 */
async function validateSaved(params: StreamParams, key: string, record: StreamRecord): Promise<ResolvedStream | null> {
  const verdict = await Promise.race([
    checkLink(record),
    new Promise<undefined>(r => setTimeout(() => r(undefined), VALIDATE_CAP_MS))
  ]);
  if (verdict !== false) {
    markStreamChecked(key, verdict); // alive, or could not be judged: either way it was just looked at
    return { ...(record.value as ResolvedStream) };
  }
  markStreamDead(key);
  memoryCache.delete(key);
  // Other servers' links saved by the same lookup, best first, skipping any known dead. They are
  // checked side by side under one short cap (one after another, each could take ~8 s and Play
  // waited for all of them); a check that runs out of time counts as "could not judge" (usable).
  const servers = (record.value as ResolvedStream).availableServers ?? [];
  const alts = servers
    .filter(s => s.serverId !== (record.value as ResolvedStream).serverId)
    .map(s => {
      const altKey = keyOf({ ...params, preferredServerId: s.serverId });
      return { altKey, alt: getStreamRecord<ResolvedStream>(altKey) };
    })
    .filter((a): a is { altKey: string; alt: StreamRecord<ResolvedStream> } => Boolean(a.alt && a.alt.status !== 'dead' && a.alt.value.url))
    .slice(0, ALT_CHECK_MAX);
  if (alts.length === 0) return null;
  const verdicts = await Promise.all(alts.map(({ alt }) => Promise.race([
    checkLink(alt),
    new Promise<undefined>(r => setTimeout(() => r(undefined), ALT_CHECK_CAP_MS))
  ])));
  for (let i = 0; i < alts.length; i++) {
    const { altKey, alt } = alts[i];
    if (verdicts[i] === false) { markStreamDead(altKey); continue; }
    markStreamChecked(altKey, verdicts[i]);
    // The title's own entry now points at the working server, so the next Play is instant.
    if (!params.preferredServerId) putStream(key, { ...alt.value }, [], paramsForStore(params));
    return { ...alt.value };
  }
  return null;
}

/**
 * The stream for `params`. Pass `signal` when the caller may stop caring (the player closed, another
 * episode was picked): once every such caller has left, the lookup itself is cancelled.
 */
export function resolveStream(params: StreamParams, options: { fresh?: boolean; signal?: AbortSignal } = {}): Promise<ResolvedStream> {
  const key = keyOf(params);

  // The user asked for this very lookup: it must not also wait in the background queue.
  if (!params.prefetch) scheduler.cancel(key);

  if (!options.fresh) {
    const syncPersisted = getLiveStream<ResolvedStream>(key);
    if (syncPersisted && syncPersisted.url) {
      const record = getStreamRecord<ResolvedStream>(key);
      // Saved long ago and not confirmed since: make sure it still answers before playback starts.
      const maxAgeMs = (syncPersisted as { revalidateAfterMs?: number }).revalidateAfterMs ?? VALIDATE_AFTER_MS;
      if (!params.prefetch && record && Date.now() - record.checkedAt > maxAgeMs) {
        const startedAt = Date.now();
        return validateSaved(params, key, record).then(valid => {
          if (valid) {
            recordTiming({ phase: 'lookup', ms: Date.now() - startedAt, outcome: 'cache', serverId: valid.serverId, titleId: params.id, title: params.title });
            return valid;
          }
          return resolveStream(params, options); // dead and no saved alternative: look it up again
        });
      }
      if (!params.prefetch) recordTiming({ phase: 'lookup', ms: 0, outcome: 'cache', serverId: syncPersisted.serverId, titleId: params.id, title: params.title });
      return Promise.resolve({ ...syncPersisted });
    }

    const existing = memoryCache.get(key);
    // A speculative (background) sniff is never waited on: the user's own lookup starts at once and
    // the native side hands it the WebView (the speculative one is cancelled).
    const yieldToUser = Boolean(existing?.speculative) && !params.prefetch;
    if (existing && !yieldToUser && Date.now() - existing.at < REUSE_MS) {
      // A background prefetch never uses the web-view sniffer, so if it came
      // up empty a real playback request must try again with the full pipeline.
      if (existing.prefetch && !params.prefetch) {
        const prior = existing.promise;
        const entry = startEntry(key, { prefetch: false }, signal => prior.catch(() => resolveUncached({ ...params, prefetch: false }, signal)));
        return attach(key, entry, options.signal);
      }
      return attach(key, existing, options.signal);
    }
  }

  const entry = startEntry(
    key,
    { prefetch: Boolean(params.prefetch), speculative: Boolean(params.speculative) },
    signal => resolveUncached(options.fresh ? { ...params, fresh: true } : params, signal)
  );
  // A lookup the user is waiting on: background prefetching yields to it.
  if (!params.prefetch) scheduler.trackUrgent(entry.promise);

  return attach(key, entry, options.signal);
}

// Background lookups wait here, most important first (see streamScheduler.ts).
const scheduler = new StreamScheduler<StreamParams>(
  // Whether the sniffer may be used is decided when the job runs, not when it was queued.
  params => resolveStream({
    ...params,
    prefetch: true,
    speculative: Boolean(params.speculative) && speculationAllowed({ nextEpisode: params.nextEpisode })
  }),
  { concurrency: 2 }
);

/**
 * Looks a saved stream up again in the background (lowest priority), e.g. after the
 * idle check found its link dead. The new result replaces the old record.
 */
export function refreshSavedStream(record: StreamRecord): void {
  const params = record.params as StreamParams | undefined;
  if (!params || typeof params.id !== 'number') return;
  memoryCache.delete(record.key);
  scheduler.enqueue(record.key, { ...params, fresh: true }, Priority.IDLE);
}

/** True when a usable stream for these params is already saved or being resolved. */
function isResolved(params: StreamParams): boolean {
  const key = keyOf(params);
  return Boolean(getLiveStream<ResolvedStream>(key)?.url) || memoryCache.has(key);
}

/**
 * Resolves a stream in the background, in priority order. Lower `priority` runs
 * first (see Priority); asking again for a queued title with a better priority
 * promotes it. Never launches the web-view sniffer.
 */
export function prefetchStream(params: StreamParams, options: { priority?: number } = {}): void {
  if (isResolved(params) || isNegative(keyOf(params))) return;
  const priority = options.priority ?? Priority.POSTER;
  if (priority <= Priority.PLAYBACK) {
    resolveStream({ ...params, prefetch: true }).catch(() => {});
    return;
  }
  // The most likely next plays are worth a background sniff, not only a plain lookup.
  scheduler.enqueue(keyOf(params), { ...params, speculative: priority <= Priority.FOCUS }, priority);
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
// The next episode gets the full lookup (with the sniffer), started a little into playback so it
// does not compete with the current episode's first seconds of buffering; the one after it gets the
// plain lookup only.
const NEXT_EPISODE_DELAY_MS = 15_000;
let nextEpisodeTimer: ReturnType<typeof setTimeout> | undefined;

export function prefetchUpcomingEpisodes(
  base: Omit<StreamParams, 'episode' | 'prefetch'>,
  currentEpisode: number,
  knownEpisodes: number[],
  count = 2
): void {
  const upcoming = knownEpisodes.filter(n => n > currentEpisode).sort((a, b) => a - b).slice(0, count);
  if (nextEpisodeTimer) clearTimeout(nextEpisodeTimer);
  if (upcoming.length === 0) return;
  nextEpisodeTimer = setTimeout(() => {
    nextEpisodeTimer = undefined;
    // Next episode first (FIFO among equal priority), ahead of every poster prefetch.
    prefetchStream({ ...base, episode: upcoming[0], nextEpisode: true }, { priority: Priority.NEXT_EPISODE });
    upcoming.slice(1).forEach(n => prefetchStream({ ...base, episode: n }, { priority: Priority.RAIL }));
  }, NEXT_EPISODE_DELAY_MS);
}
