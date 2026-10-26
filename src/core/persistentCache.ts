// persistentCache.ts - Hybrid IndexedDB & LocalStorage cache with TTL expiry
export const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheRecord<T> {
  data: T;
  savedAt: number;
  ttlMs: number;
}

const DB_NAME = 'CineStreamCacheDB';
const STORE_NAME = 'media_cache';
const DB_VERSION = 1;

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

export async function readPersistedAsync<T>(key: string): Promise<T | null> {
  const syncData = readPersisted<T>(key);
  if (syncData) return syncData;

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
          return resolve(null);
        }
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

  try {
    localStorage.setItem(`cinestream_cache_${key}`, JSON.stringify(record));
  } catch {
    // LocalStorage full, fallback to IDB write
  }

  getIDB().then(db => {
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record, key);
    } catch {}
  }).catch(() => {});
}

export function clearPersistedCache(): void {
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
