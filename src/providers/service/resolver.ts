// resolver.ts - The stream for a title or episode: from the saved links when they still work, else from
// a lookup (engine/registry.ts). Everything the app asks of the provider layer goes through here.
//
//   resolveStream    the stream to play now (the user is waiting)
//   prefetchStream   the same, in the background, in priority order (scheduler.ts)
//   forgetStream     a link failed to play: never hand it out again
//
// Saved links: one record per title/episode (streamStore.ts) holds the stream that plays plus every
// other direct link the lookup found. A picked server, a failover after a dead link, or the next visit
// is served from that record without asking any provider. A record older than its links' lifetime is
// checked (briefly) before it is handed out; a dead link falls over to the next saved one.
import { Capacitor } from '@capacitor/core';
import { getMediaDetails, type MediaType } from '../cineHypeCore.ts';
import {
  dropRecordsWithout, getStreamRecord, markLinkChecked, markStreamDead, putStream, streamStoreReady, updateStreamValue,
  type StreamRecord
} from './streamStore.ts';
import { extractorRegistry } from '../engine/registry.ts';
import { fetchSubtitles } from './subtitles.ts';
import type { AlternateStream, ExtractedStream, ExtractorSubtitle } from '../core/types.ts';
import { Priority, StreamScheduler } from './scheduler.ts';
import { recordTiming } from './timings.ts';
import { checkLink } from './revalidator.ts';
import { speculationAllowed } from './speculation.ts';
import { FailureMemo, LookupCache, abortError } from './lookupCache.ts';

// The film's runtime lets the registry tell a stream of another title by its length. The details are
// usually cached already (the title page loaded them).
extractorRegistry.setRuntimeLookup(id => getMediaDetails(id, 'movie').then(d => (d.runtime && d.runtime > 0 ? d.runtime : undefined)));

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
  // Retry after a failure: skip remembered-provider shortcuts and saved links.
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

// ---- keys -------------------------------------------------------------------------------

// v16: one record per title holding every link (was one record per server), keyed without the title
// text; records of older versions are dropped when the store loads.
const STORE_VERSION = 'v16';
/** Where a title's links are saved: what identifies the content, nothing about how it was asked for. */
const storeKey = (p: StreamParams) => `${STORE_VERSION}|${p.type}|${p.id}|${p.season ?? 0}|${p.episode ?? 0}|${p.languageMode ?? 'sub'}|${p.language ?? ''}`;
/** One running lookup per content and picked server. */
const lookupKey = (p: StreamParams) => `${storeKey(p)}|${p.preferredServerId ?? ''}`;

void streamStoreReady.then(() => dropRecordsWithout(`${STORE_VERSION}|`));

// ---- timing constants ---------------------------------------------------------------------

// How long a ready stream waits for the (optional) external subtitle lookup.
const SUBTITLE_GRACE_MS = 300;
// Titles every provider failed for a moment ago: background prefetching leaves them alone.
const NEGATIVE_MS = 60_000;
// Sniffing saved embed pages after a failed lookup is skipped when the lookup already took this long.
const REVIVE_BUDGET_MS = 8_000;
// A saved link last confirmed longer ago than this is checked before it reaches the player...
const VALIDATE_AFTER_MS = 15 * 60 * 1000;
// ...but the check never holds playback up for longer than this.
const VALIDATE_CAP_MS = 600;
// Saved alternatives checked at once when the saved link is dead, and their cap.
const ALT_CHECK_MAX = 3;
const ALT_CHECK_CAP_MS = 1500;
// Alternates handed to the player at most.
const MAX_ALTERNATES = 4;

const lookups = new LookupCache<ResolvedStream>();
const failed = new FailureMemo(NEGATIVE_MS);

// ---- presenting saved links ---------------------------------------------------------------

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

const liveLinks = (r: StreamRecord<ResolvedStream>) => (r.links ?? []).filter(l => l.status !== 'dead').map(l => l.stream);

/** A saved link as the player gets it: the title's facts, the server list, alternates, all subtitles. */
function present(record: StreamRecord<ResolvedStream>, link: ExtractedStream, params: StreamParams): ResolvedStream {
  const main = record.value;
  const own = link.subtitles ?? [];
  const extra = (main.subtitles ?? []).filter(t => !own.some(o => o.url === t.url));
  const alternates = pickAlternates(link, liveLinks(record));
  return {
    ...link,
    id: params.id, type: params.type, season: params.season, episode: params.episode,
    title: params.title, language: params.language,
    availableServers: main.availableServers,
    subtitles: link.url === main.url ? main.subtitles : [...own, ...extra],
    ...(alternates.length ? { alternates } : {})
  };
}

/** The saved link this request would get (dead ones never), with its record. */
function savedFor(params: StreamParams): { record: StreamRecord<ResolvedStream>; link: ExtractedStream; checkedAt: number } | null {
  const record = getStreamRecord<ResolvedStream>(storeKey(params));
  if (!record) return null;
  if (!params.preferredServerId) {
    return record.status !== 'dead' && record.value.url ? { record, link: record.value, checkedAt: record.checkedAt } : null;
  }
  const saved = record.links?.find(l => l.stream.serverId === params.preferredServerId && l.status !== 'dead');
  return saved ? { record, link: saved.stream, checkedAt: saved.checkedAt } : null;
}

// ---- failure ------------------------------------------------------------------------------

/**
 * A stream failed to play: neither a retry nor the next visit is handed the same link. `failedServerId`
 * names the server that failed when the player knows it (it may have failed over by itself).
 */
export function forgetStream(params: StreamParams, failedServerId?: string): void {
  lookups.delete(lookupKey(params));
  const key = storeKey(params);
  const record = getStreamRecord<ResolvedStream>(key);
  if (!record) return;
  const serverId = failedServerId ?? params.preferredServerId ?? record.value.serverId;
  // Kept (flagged dead) rather than deleted: the next lookup replaces it.
  for (const l of record.links ?? []) if (l.stream.serverId === serverId) markLinkChecked(key, l.stream.url, false);
  if (record.value.serverId === serverId) markStreamDead(key);
}

// ---- lookup -------------------------------------------------------------------------------

// Tries saved embed pages with the sniffer, a couple at most. Native only; a no-op elsewhere.
async function reviveFromEmbeds(params: StreamParams, embeds: ExtractedStream[]): Promise<ExtractedStream | null> {
  if (params.prefetch || !Capacitor.isNativePlatform()) return null;
  // Not the pages of servers whose stream just failed to play.
  const excluded = new Set(params.exclude ?? []);
  for (const embed of embeds.filter(e => !e.serverId || !excluded.has(e.serverId)).slice(0, 2)) {
    const stream = await extractorRegistry.sniffEmbed(embed).catch(() => null);
    if (stream && stream.url) return { ...stream, serverId: embed.serverId, serverName: embed.serverName };
  }
  return null;
}

// The part of the params a later lookup needs (no flags), kept with the saved links.
function paramsForStore(p: StreamParams): Record<string, unknown> {
  const { prefetch: _p, fresh: _f, exclude: _e, nextEpisode: _n, preferredServerId: _s, speculative: _sp, ...rest } = p;
  return rest;
}

/** Times the whole lookup, from request to a stream the player can use. */
async function lookUp(params: StreamParams, signal: AbortSignal): Promise<ResolvedStream> {
  const startedAt = Date.now();
  const note = (outcome: 'ok' | 'fail' | 'cache', serverId?: string) => recordTiming({
    phase: 'lookup', ms: Date.now() - startedAt, outcome, serverId, titleId: params.id, title: params.title, background: Boolean(params.prefetch)
  });
  try {
    await streamStoreReady;
    const saved = params.fresh ? null : savedFor(params);
    if (saved) {
      note('cache', saved.link.serverId);
      return present(saved.record, saved.link, params);
    }
    const result = await lookUpProviders(params, signal);
    failed.clear(storeKey(params));
    note('ok', result.serverId);
    return result;
  } catch (err) {
    // Nobody wanted it any more: that says nothing about the title or its providers.
    if (signal.aborted) throw abortError();
    note('fail');
    failed.note(storeKey(params));
    throw err;
  }
}

async function lookUpProviders(params: StreamParams, signal: AbortSignal): Promise<ResolvedStream> {
  const key = storeKey(params);
  const startedAt = Date.now();
  const previous = getStreamRecord<ResolvedStream>(key);
  const foundEmbeds: ExtractedStream[] = [];
  const subtitlesPromise = fetchSubtitles(params);

  let all: ExtractedStream[] = [];
  try {
    all = await extractorRegistry.resolveAllStreams({
      id: params.id, type: params.type, season: params.season, episode: params.episode,
      title: params.title, originalTitle: params.originalTitle, year: params.year, language: params.language,
      allowSniff: !params.prefetch || Boolean(params.speculative),
      sniffBackground: Boolean(params.prefetch),
      fresh: params.fresh,
      preferredServerId: params.preferredServerId,
      exclude: params.exclude,
      signal,
      onEmbed: embed => { if (!foundEmbeds.some(e => e.url === embed.url)) foundEmbeds.push(embed); }
    });
  } catch (err) {
    console.warn('[resolver] lookup error:', err);
  }
  if (signal.aborted) throw abortError();

  const embeds = [...foundEmbeds, ...(previous?.embeds ?? [])].filter((e, i, a) => a.findIndex(x => x.url === e.url) === i);
  // The race asked every provider (the picked server first): what it found is all there is.
  let picked = await extractorRegistry.resolveBestStream(params, all).catch(() => null);
  if (!picked) {
    // Embed pages saved by earlier lookups can still be turned into a direct stream by the native
    // sniffer (a hidden web view; the embed itself is never played).
    const revived = Date.now() - startedAt > REVIVE_BUDGET_MS ? null : await reviveFromEmbeds(params, embeds);
    if (signal.aborted) throw abortError();
    if (!revived) throw new Error('No working stream was found for this title right now. It may not be available yet - try again in a moment.');
    all.push(revived);
    picked = revived;
  }

  // Every registered server is listed (the player's server menu), found or not.
  const servers = new Map<string, { serverId: string; serverName: string; isFallbackEmbed?: boolean }>();
  for (const s of all) if (s.serverId) servers.set(s.serverId, { serverId: s.serverId, serverName: s.serverName || s.serverId, isFallbackEmbed: s.isFallbackEmbed });
  for (const e of extractorRegistry.getAllExtractors()) if (!servers.has(e.id)) servers.set(e.id, { serverId: e.id, serverName: e.name, isFallbackEmbed: false });

  // What plays when nobody picks a server: the election's choice (the same as `picked` unless a
  // server was picked).
  const main = params.preferredServerId
    ? (previous && previous.status !== 'dead' ? previous.value : await extractorRegistry.resolveBestStream({ ...params, preferredServerId: undefined }, all).catch(() => null)) ?? picked
    : picked;
  const mainValue: ResolvedStream = {
    ...main,
    id: params.id, type: params.type, season: params.season, episode: params.episode, title: params.title, language: params.language,
    availableServers: [...servers.values()]
  };
  delete mainValue.alternates;

  // Subtitles the stream itself carries stay first; external ones are added after. Playback never
  // waits long for them: a slow lookup's subtitles are saved with the record when they arrive.
  const withExternal = (target: ResolvedStream, external: ExtractorSubtitle[]): ResolvedStream => {
    const have = new Set((target.subtitles ?? []).map(t => t.url));
    return external.length ? { ...target, subtitles: [...(target.subtitles ?? []), ...external.filter(t => !have.has(t.url))] } : target;
  };
  const early = await Promise.race([subtitlesPromise, new Promise<null>(r => setTimeout(() => r(null), SUBTITLE_GRACE_MS))]);
  const stored = withExternal(mainValue, early ?? []);
  // Saved permanently: replaced only by a newer lookup, or flagged dead when it stops working.
  const links = [picked, ...all.filter(s => s.url !== picked!.url && !s.isFallbackEmbed && s.url)];
  if (!links.some(l => l.url === stored.url)) links.push(stored);
  putStream(key, stored, embeds, paramsForStore(params), links);
  if (early === null) {
    subtitlesPromise.then(late => {
      const current = getStreamRecord<ResolvedStream>(key);
      if (late.length && current && current.value.url === stored.url) updateStreamValue(key, withExternal(current.value, late));
    }).catch(() => {});
  }
  return present(getStreamRecord<ResolvedStream>(key)!, picked, params);
}

// ---- saved-link validation ----------------------------------------------------------------

const capped = <T,>(work: Promise<T>, ms: number) => Promise.race([work, new Promise<undefined>(r => setTimeout(() => r(undefined), ms))]);

/**
 * Confirms a saved link still answers. If not, it is flagged dead and the next best saved link of the
 * same title is used - no new lookup. Resolves null when nothing saved is usable.
 */
async function validateSaved(params: StreamParams, saved: NonNullable<ReturnType<typeof savedFor>>): Promise<ResolvedStream | null> {
  const key = storeKey(params);
  const { record, link } = saved;
  const verdict = await capped(checkLink({ ...record, value: link }), VALIDATE_CAP_MS);
  // Alive, or could not be judged: either way it was just looked at.
  markLinkChecked(key, link.url, verdict);
  if (verdict !== false) return present(record, link, params);
  if (link.url === record.value.url) markStreamDead(key);
  lookups.delete(lookupKey(params));
  // A picked server's own link is dead: a new lookup (another server would not be what was picked).
  if (params.preferredServerId) return null;

  // Other saved links, best first, checked side by side under one short cap; a check that runs out of
  // time counts as "could not judge" (usable).
  const alts = (getStreamRecord<ResolvedStream>(key)?.links ?? [])
    .filter(l => l.status !== 'dead' && l.stream.url !== link.url)
    .slice(0, ALT_CHECK_MAX);
  if (alts.length === 0) return null;
  const verdicts = await Promise.all(alts.map(l => capped(checkLink({ ...record, value: l.stream }), ALT_CHECK_CAP_MS)));
  for (let i = 0; i < alts.length; i++) {
    markLinkChecked(key, alts[i].stream.url, verdicts[i]);
    if (verdicts[i] === false) continue;
    // The title's record now plays the working link, so the next Play is instant.
    const now = getStreamRecord<ResolvedStream>(key)!;
    putStream(key, { ...now.value, ...alts[i].stream, availableServers: now.value.availableServers, subtitles: now.value.subtitles });
    return present(getStreamRecord<ResolvedStream>(key)!, alts[i].stream, params);
  }
  return null;
}

// ---- public API ---------------------------------------------------------------------------

/**
 * The stream for `params`. Pass `signal` when the caller may stop caring (the player closed, another
 * episode was picked): once every such caller has left, the lookup itself is cancelled.
 */
export function resolveStream(params: StreamParams, options: { fresh?: boolean; signal?: AbortSignal } = {}): Promise<ResolvedStream> {
  const fresh = Boolean(options.fresh || params.fresh);
  const key = lookupKey(params);

  // The user asked for this very lookup: it must not also wait in the background queue.
  if (!params.prefetch) scheduler.cancel(key);

  if (!fresh) {
    const saved = savedFor(params);
    if (saved) {
      const maxAgeMs = saved.link.revalidateAfterMs ?? VALIDATE_AFTER_MS;
      // Saved long ago and not confirmed since: make sure it still answers before playback starts.
      if (!params.prefetch && Date.now() - saved.checkedAt > maxAgeMs) {
        const startedAt = Date.now();
        return validateSaved(params, saved).then(valid => {
          if (!valid) return resolveStream(params, options); // dead and no saved alternative
          recordTiming({ phase: 'lookup', ms: Date.now() - startedAt, outcome: 'cache', serverId: valid.serverId, titleId: params.id, title: params.title });
          return valid;
        });
      }
      if (!params.prefetch) recordTiming({ phase: 'lookup', ms: 0, outcome: 'cache', serverId: saved.link.serverId, titleId: params.id, title: params.title });
      return Promise.resolve(present(saved.record, saved.link, params));
    }

    const existing = lookups.get(key);
    // A speculative (background) sniff is never waited on: the user's own lookup starts at once and
    // the native side hands it the WebView (the speculative one is cancelled).
    if (existing && !(existing.speculative && !params.prefetch)) {
      // A background prefetch never uses the sniffer: if it comes up empty, a real playback request
      // must try again with the full pipeline.
      if (existing.prefetch && !params.prefetch) {
        const prior = existing.promise;
        const entry = lookups.start(key, { prefetch: false }, signal => prior.catch(() => lookUp({ ...params, prefetch: false }, signal)));
        scheduler.trackUrgent(entry.promise);
        return lookups.attach(key, entry, options.signal);
      }
      return lookups.attach(key, existing, options.signal);
    }
  }

  const entry = lookups.start(
    key,
    { prefetch: Boolean(params.prefetch), speculative: Boolean(params.speculative) },
    signal => lookUp(fresh ? { ...params, fresh: true } : params, signal)
  );
  // A lookup the user is waiting on: background prefetching yields to it.
  if (!params.prefetch) scheduler.trackUrgent(entry.promise);
  return lookups.attach(key, entry, options.signal);
}

// Background lookups wait here, most important first (see scheduler.ts).
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
 * Looks a saved title up again in the background (lowest priority), e.g. after the idle check found its
 * link dead. The new result replaces the old record.
 */
export function refreshSavedStream(record: StreamRecord): void {
  const params = record.params as StreamParams | undefined;
  if (!params || typeof params.id !== 'number') return;
  lookups.delete(lookupKey(params));
  scheduler.enqueue(lookupKey(params), { ...params, fresh: true }, Priority.IDLE);
}

/** True when a usable stream for these params is already saved or being resolved. */
function isResolved(params: StreamParams): boolean {
  return Boolean(savedFor(params)) || lookups.has(lookupKey(params));
}

/**
 * Resolves a stream in the background, in priority order. Lower `priority` runs first (see Priority);
 * asking again for a queued title with a better priority promotes it.
 */
export function prefetchStream(params: StreamParams, options: { priority?: number } = {}): void {
  if (isResolved(params) || failed.has(storeKey(params))) return;
  const priority = options.priority ?? Priority.POSTER;
  if (priority <= Priority.PLAYBACK) {
    resolveStream({ ...params, prefetch: true }).catch(() => {});
    return;
  }
  // The most likely next plays are worth a background sniff, not only a plain lookup.
  scheduler.enqueue(lookupKey(params), { ...params, speculative: priority <= Priority.FOCUS }, priority);
}

/** Warms the saved links for titles on screen, so the first tap plays at once. */
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

// While an episode plays, resolve the next few so they start at once. Uses exactly the params
// playback uses, so the saved result is a direct hit. The next episode gets the full lookup (with the
// sniffer), started a little into playback so it does not compete with the current episode's first
// seconds of buffering; the one after it gets the plain lookup only.
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

/** Forgets every lookup kept in memory and the recent failures (Settings > Clear Cache). */
export function clearResolvedStreams(): void {
  lookups.clearSettled();
  failed.clear();
}
