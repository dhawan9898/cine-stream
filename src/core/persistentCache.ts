// persistentCache.ts - High-speed LocalStorage cache with TTL expiry
export const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheRecord<T> {
  data: T;
  savedAt: number;
  ttlMs: number;
}

export function readPersisted<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`cinestream_cache_${key}`);
    if (!raw) return null;
    const record: CacheRecord<T> = JSON.parse(raw);
    if (Date.now() - record.savedAt > record.ttlMs) {
      localStorage.removeItem(`cinestream_cache_${key}`);
      return null;
    }
    return record.data;
  } catch {
    return null;
  }
}

export function writePersisted<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  try {
    const record: CacheRecord<T> = {
      data,
      savedAt: Date.now(),
      ttlMs
    };
    localStorage.setItem(`cinestream_cache_${key}`, JSON.stringify(record));
  } catch {
    // LocalStorage quota may be full, gracefully ignore
  }
}

export function clearPersistedCache(): void {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('cinestream_cache_'));
    keys.forEach(k => localStorage.removeItem(k));
  } catch {}
}
