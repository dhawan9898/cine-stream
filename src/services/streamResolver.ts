// streamResolver.ts - Background multi-source stream resolution engine for exact TMDB titles
import type { MediaType } from '../core/cineHypeCore.ts';
import { extractorRegistry } from '../extractors/extractorRegistry.ts';
import type { ExtractedStream } from '../extractors/types.ts';

export interface StreamParams {
  id: number;
  type: MediaType;
  season?: number;
  episode?: number;
  languageMode?: string;
  title?: string;
}

export interface ResolvedStream extends ExtractedStream {
  id: number;
  type: MediaType;
  season?: number;
  episode?: number;
  languageMode?: string;
  title?: string;
}

const cache = new Map<string, { at: number; promise: Promise<ResolvedStream> }>();
const REUSE_MS = 4 * 60 * 1000;
const keyOf = (p: StreamParams) => `${p.type}|${p.id}|${p.season ?? 0}|${p.episode ?? 0}|${p.languageMode ?? 'sub'}|${p.title ?? ''}`;

function getTitleFallbackUrl(params: StreamParams): string {
  const { id, type, season = 1, episode = 1 } = params;
  if (type === 'tv') {
    return `https://vidlink.pro/tv/${id}/${season}/${episode}?primaryColor=ec1c24&autoplay=true`;
  }
  return `https://vidlink.pro/movie/${id}?primaryColor=ec1c24&autoplay=true`;
}

async function resolveUncached(params: StreamParams): Promise<ResolvedStream> {
  try {
    const extracted = await extractorRegistry.resolveBestStream({
      id: params.id,
      type: params.type,
      season: params.season,
      episode: params.episode,
      title: params.title
    });

    if (extracted && extracted.url) {
      return {
        ...extracted,
        id: params.id,
        type: params.type,
        season: params.season,
        episode: params.episode,
        title: params.title
      };
    }
  } catch (err) {
    console.warn('[StreamResolver] Background extraction error:', err);
  }

  // Exact TMDB title fallback URL
  const fallbackUrl = getTitleFallbackUrl(params);
  return {
    url: fallbackUrl,
    format: 'hls',
    isFallbackEmbed: true,
    id: params.id,
    type: params.type,
    season: params.season,
    episode: params.episode,
    title: params.title
  };
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
