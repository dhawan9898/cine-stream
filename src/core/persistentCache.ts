// persistentCache.ts - Hybrid IndexedDB, LocalStorage & L1 Memory cache with TTL expiry
export const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_PREFIX = 'cinestream_cache_v5_';

interface CacheRecord<T> {
  data: T;
  savedAt: number;
  ttlMs: number;
}

const DB_NAME = 'CineStreamCacheDB';
const STORE_NAME = 'media_cache';
const DB_VERSION = 1;

// L1 In-Memory Cache for 0ms synchronous hits
const memoryL1Map = new Map<string, CacheRecord<unknown>>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function getIDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  dbPromise = new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return dbPromise;
}

// Garbage-collects expired entries from LocalStorage to keep quota clean
export function pruneExpiredPersistedCache(): void {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('cinestream_cache_'));
    const now = Date.now();
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const record: CacheRecord<unknown> = JSON.parse(raw);
        if (now - record.savedAt > record.ttlMs || !key.startsWith(CACHE_PREFIX)) {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {}
}

export function readPersisted<T>(key: string): T | null {
  // 1. Check L1 Memory Cache
  const memoryRecord = memoryL1Map.get(key) as CacheRecord<T> | undefined;
  if (memoryRecord) {
    if (Date.now() - memoryRecord.savedAt <= memoryRecord.ttlMs) {
      return memoryRecord.data;
    }
    memoryL1Map.delete(key);
  }

  // 2. Check L2 LocalStorage
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const record: CacheRecord<T> = JSON.parse(raw);
    if (Date.now() - record.savedAt > record.ttlMs) {
      localStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
    // Populate L1 Memory Map
    memoryL1Map.set(key, record);
    return record.data;
  } catch {
    return null;
  }
}

export async function readPersistedAsync<T>(key: string): Promise<T | null> {
  // Check L1 & L2 first
  const syncData = readPersisted<T>(key);
  if (syncData) return syncData;

  // 3. Check L3 IndexedDB
  try {
    const db = await getIDB();
    if (!db) return null;
    return new Promise(resolve => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const record = req.result as CacheRecord<T> | undefined;
        if (!record) return resolve(null);
        if (Date.now() - record.savedAt > record.ttlMs) {
          try {
            const delTx = db.transaction(STORE_NAME, 'readwrite');
            delTx.objectStore(STORE_NAME).delete(key);
          } catch {}
          return resolve(null);
        }

        // Populate L1 & L2
        memoryL1Map.set(key, record);
        try {
          localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(record));
        } catch {}

        resolve(record.data);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function writePersisted<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  const record: CacheRecord<T> = {
    data,
    savedAt: Date.now(),
    ttlMs
  };

  // 1. Write L1 Memory Map
  memoryL1Map.set(key, record);

  // 2. Write L2 LocalStorage
  try {
    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(record));
  } catch {
    // If quota exceeded, prune expired keys and retry once
    pruneExpiredPersistedCache();
    try {
      localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(record));
    } catch {
      // Quota still full, fallback to L3 IndexedDB only
    }
  }

  // 3. Write L3 IndexedDB
  getIDB().then(db => {
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record, key);
    } catch {}
  }).catch(() => {});
}

export function clearStreamCache(): void {
  memoryL1Map.clear();
  try {
    const keys = Object.keys(localStorage).filter(k => k.includes('stream_'));
    keys.forEach(k => localStorage.removeItem(k));
  } catch {}
}

export function clearPersistedCache(): void {
  memoryL1Map.clear();
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('cinestream_cache_'));
    keys.forEach(k => localStorage.removeItem(k));
  } catch {}

  getIDB().then(db => {
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
    } catch {}
  }).catch(() => {});
}

// Initial cleanup on module load
pruneExpiredPersistedCache();
clearStreamCache();
