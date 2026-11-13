// manifest.ts - Reading a provider's manifest (see types.ts#SourceManifest) with sane defaults.
import type { SourceManifest, StreamExtractor } from './types.ts';

/** A provider without a manifest: a plain TMDB-id JSON API (the ApiExtractor case, test fakes). */
export const DEFAULT_MANIFEST: SourceManifest = { idKind: 'tmdb', costHint: 'api', trust: 'api' };

/** Expected ms to a stream by cost class, used until a provider has been measured. */
const PRIOR_BY_COST: Record<SourceManifest['costHint'], number> = {
  instant: 400,
  api: 2000,
  'multi-hop': 3500,
  sniff: 6000
};

const TRUST_RANK: Record<NonNullable<SourceManifest['trust']>, number> = { 'self-hosted': 0, api: 1, scraper: 2 };

export function manifestOf(e: Pick<StreamExtractor, 'manifest'>): SourceManifest {
  return e.manifest ?? DEFAULT_MANIFEST;
}

/** Cheap providers start at once; expensive ones wait for a hedge delay (see the registry). */
export function isCheap(e: Pick<StreamExtractor, 'manifest'>): boolean {
  const c = manifestOf(e).costHint;
  return c === 'instant' || c === 'api';
}

export function priorMs(e: Pick<StreamExtractor, 'manifest'>): number {
  const m = manifestOf(e);
  return m.priorMs ?? PRIOR_BY_COST[m.costHint];
}

export function trustRank(e: Pick<StreamExtractor, 'manifest'>): number {
  return TRUST_RANK[manifestOf(e).trust ?? 'scraper'];
}

/** Whether the provider declared itself strong for this title (its kind or original language). */
export function strongFor(e: Pick<StreamExtractor, 'manifest'>, title: { type: 'movie' | 'tv'; language?: string }): boolean {
  const s = manifestOf(e).strongFor;
  if (!s) return false;
  const lang = (title.language ?? '').toLowerCase().split('-')[0];
  return Boolean(s.kinds?.includes(title.type)) || Boolean(lang && s.languages?.includes(lang));
}
