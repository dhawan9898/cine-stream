// persistentCache.ts - CineStream's cache, configured on the shared tiered cache
// (memory -> localStorage -> IndexedDB) in streamkit.
import { createPersistentCache, DEFAULT_TTL_MS } from 'streamkit/core/persistentCache.ts';

export { DEFAULT_TTL_MS };

const cache = createPersistentCache({
  prefix: 'cinestream_cache_v5_',
  legacyPrefix: 'cinestream_cache_',
  maxChars: 2_500_000,
  defaultTtlMs: DEFAULT_TTL_MS,
  idb: { dbName: 'CineStreamCacheDB', storeName: 'media_cache' }
});

export const readPersisted = cache.get;
export const readPersistedAsync = cache.getAsync;
export const writePersisted = cache.set;
export const clearPersistedCache = cache.clear;
export const pruneExpiredPersistedCache = cache.prune;

export function clearStreamCache(): void {
  try {
    Object.keys(localStorage).filter(k => k.includes('stream_')).forEach(k => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
}

// Initial cleanup on module load
cache.prune();
