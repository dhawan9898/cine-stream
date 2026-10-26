// streamResolver.ts - Background multi-source stream resolution engine
import type { MediaType } from '../core/cineHypeCore.ts';
import { extractorRegistry } from '../extractors/extractorRegistry.ts';
import type { ExtractedStream } from '../extractors/types.ts';

export interface StreamParams {
  id: number;
  type: MediaType;
  season?: number;
  episode?: number;
}

export interface ResolvedStream extends ExtractedStream {
  id: number;
  type: MediaType;
  season?: number;
  episode?: number;
}

const cache = new Map<string, { at: number; promise: Promise<ResolvedStream> }>();
const REUSE_MS = 4 * 60 * 1000;
const keyOf = (p: StreamParams) => `${p.type}|${p.id}|${p.season ?? 0}|${p.episode ?? 0}`;

async function resolveUncached(params: StreamParams): Promise<ResolvedStream> {
  const extracted = await extractorRegistry.resolveBestStream({
    id: params.id,
    type: params.type,
    season: params.season,
    episode: params.episode
  });

  if (extracted && extracted.url) {
    return {
      ...extracted,
      id: params.id,
      type: params.type,
      season: params.season,
      episode: params.episode
    };
  }

  throw new Error('Failed to resolve direct video stream for this title.');
}

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

  return entry.promise.then(s => ({ ...s }));
}
