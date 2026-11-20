// planner.ts - Who runs when in a lookup. Pure: no timers, no network, no learning (it is handed what
// has been learned), so every rule here is tested on its own.
//
// A plan splits the usable providers in two groups:
//   head  start at once
//   rest  start when the head start ends - or at once, when the head group has come up empty
// and says which providers the race waits for (they have the title's other languages) and which
// embed pages it must not use (the player pages of providers whose stream just failed).
//
// Modes, first that applies:
//   preferred  the viewer picked a server: everyone at once, that server first
//   last-good  the provider that played this title last time runs alone for LAST_GOOD_HEAD_START_MS
//   cheap      the cheap providers (JSON APIs, self-hosted) run alone for about their usual time,
//              the expensive ones (multi-hop scrapers, WebView sniffs) join after that
//   all        everyone at once (all cheap, or none)
// Providers strong for the title's language always start at once.
import type { StreamExtractor } from '../core/types.ts';
import { isCheap, strongForLanguage, trustRank } from '../core/manifest.ts';

export const LAST_GOOD_HEAD_START_MS = 1200;
export const CHEAP_HEAD_START_MIN_MS = 800;
export const CHEAP_HEAD_START_MAX_MS = 3500;

export interface PlanTitle {
  id: number;
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
  language?: string;
  preferredServerId?: string;
  /** A retry after a failure: no remembered-provider shortcut. */
  fresh?: boolean;
  /** Providers whose stream just failed to play. */
  exclude?: string[];
}

export interface PlannerInputs {
  /** Expected ms to a playable stream for this title (learned, or the manifest's prior; see registry). */
  plannedMs: (e: StreamExtractor) => number;
  /** Circuit breaker: may this provider be asked now? (A half-open one admits a single probe.) */
  admit: (e: StreamExtractor) => boolean;
  /** The provider that played this title last time. */
  lastGoodId?: string;
}

export type PlanMode = 'preferred' | 'last-good' | 'cheap' | 'all';

export interface RacePlan {
  mode: PlanMode;
  head: StreamExtractor[];
  rest: StreamExtractor[];
  /** How long `head` runs alone; 0 when everyone starts at once. */
  headStartMs: number;
  /** Waited for up to STRONG_PROVIDER_WAIT_MS before a faster stream ends the race. */
  strongIds: Set<string>;
  /** Embed pages not to sniff: those of the excluded providers (a shared page would bring them back). */
  blockedEmbeds: Set<string>;
  lastGoodId?: string;
}

/** Best first by expected time; ties go to the more trusted source, then registration order. */
export function rankProviders(list: StreamExtractor[], plannedMs: (e: StreamExtractor) => number): StreamExtractor[] {
  return list
    .map((e, index) => ({ e, index, score: plannedMs(e), trust: trustRank(e) }))
    .sort((a, b) => a.score - b.score || a.trust - b.trust || a.index - b.index)
    .map(x => x.e);
}

/** How long the cheap providers run alone: 1.5x the second-fastest one's expected time, bounded. */
export function cheapHeadStartMs(cheap: StreamExtractor[], plannedMs: (e: StreamExtractor) => number): number {
  const times = cheap.map(e => Math.max(0, plannedMs(e))).sort((a, b) => a - b);
  const typical = times[Math.min(1, times.length - 1)] ?? CHEAP_HEAD_START_MAX_MS;
  return Math.round(Math.min(CHEAP_HEAD_START_MAX_MS, Math.max(CHEAP_HEAD_START_MIN_MS, typical * 1.5)));
}

export function planRace(providers: StreamExtractor[], title: PlanTitle, inputs: PlannerInputs): RacePlan {
  const ordered = title.preferredServerId
    ? (() => {
        const preferred = providers.find(e => e.id === title.preferredServerId);
        return preferred ? [preferred, ...providers.filter(e => e !== preferred)] : providers;
      })()
    : rankProviders(providers, inputs.plannedMs);

  // Excluded providers sit out - unless that would leave nobody.
  const excluded = new Set(title.exclude ?? []);
  const notExcluded = ordered.filter(e => !excluded.has(e.id));
  const usable = notExcluded.length > 0 ? notExcluded : ordered;
  const blockedEmbeds = new Set<string>();
  if (usable === notExcluded) {
    for (const e of ordered) {
      if (!excluded.has(e.id) || !e.embedUrl) continue;
      try {
        const url = e.embedUrl(title);
        if (url) blockedEmbeds.add(url);
      } catch { /* no fixed page for this title */ }
    }
  }

  // Providers whose breaker is open sit out - unless that would leave nobody.
  const healthy = usable.filter(e => inputs.admit(e));
  const active = healthy.length > 0 ? healthy : usable;

  const strongIds = new Set(title.preferredServerId ? [] : active.filter(e => strongForLanguage(e, title)).map(e => e.id));
  const base = { strongIds, blockedEmbeds, lastGoodId: inputs.lastGoodId };
  const split = (headIds: Set<string>, headStartMs: number, mode: PlanMode): RacePlan => {
    for (const id of strongIds) headIds.add(id);
    return {
      ...base,
      mode,
      head: active.filter(e => headIds.has(e.id)),
      rest: active.filter(e => !headIds.has(e.id)),
      headStartMs
    };
  };

  if (title.preferredServerId) return { ...base, mode: 'preferred', head: active, rest: [], headStartMs: 0 };

  const goodId = inputs.lastGoodId;
  if (!title.fresh && goodId && active.some(e => e.id === goodId)) {
    return split(new Set([goodId]), LAST_GOOD_HEAD_START_MS, 'last-good');
  }

  const cheap = active.filter(e => isCheap(e));
  if (cheap.length > 0 && cheap.length < active.length) {
    return split(new Set(cheap.map(e => e.id)), cheapHeadStartMs(cheap, inputs.plannedMs), 'cheap');
  }
  return { ...base, mode: 'all', head: active, rest: [], headStartMs: 0 };
}
