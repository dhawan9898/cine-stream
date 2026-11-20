// streamStore.ts - Permanent store of every resolved stream link.
//
// Unlike the media cache, nothing here expires: records leave only through the
// in-app "Clear Cache" (see cacheService.ts) or when the app's data is cleared
// (Android App info). Everything is loaded into memory when the app opens, so lookups
// are synchronous afterwards; every write also goes to IndexedDB.
//
// One record per title (or episode) keeps what a lookup found: the stream that
// plays (`value`), every other direct link it found (`links`: other servers and
// lanes, each with its own check state, so a server switch or a failover starts
// from here), the embed pages it came from (for the native sniffer; never played
// as an iframe), and whether the played link was still answering the last time
// it was checked (see revalidator.ts). A link that stopped working is flagged
// "dead", not deleted, so it is replaced by the next lookup rather than lost.
import type { ExtractedStream } from '../core/types.ts';

export type LinkStatus = 'alive' | 'dead' | 'unknown';

export interface StreamRecord<T extends { url: string } = ExtractedStream> {
  key: string;
  value: T;
  /** Embed pages the lookup found for this title (sniffable, never iframed). */
  embeds: ExtractedStream[];
  /** What the lookup was asked for, so a dead link can be looked up again. */
  params?: Record<string, unknown>;
  savedAt: number;
  /** Last time the link was resolved or checked. */
  checkedAt: number;
  status: LinkStatus;
  /** Every direct link the lookup found, best first (the played one among them). */
  links?: StoredLink[];
}

export interface StoredLink<T extends { url: string } = ExtractedStream> {
  stream: T;
  status: LinkStatus;
  checkedAt: number;
}

/**
 * Most links kept. Past it the least useful ones go: dead links first, then the longest unchecked.
 * Every record is read into memory when the app opens and the first Play waits for that, while most
 * links (signed, tokenized) expire within hours anyway - so a few thousand is plenty. Was 10,000.
 */
export const MAX_STREAM_RECORDS = 2_000;
/** Evicted in batches, so the sort runs once per batch rather than on every save. */
const EVICT_BATCH = 100;
const DB_NAME = 'cinestream-streams';
const STORE = 'streams';

const records = new Map<string, StreamRecord<{ url: string }>>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function removeFromDb(keys: string[]): Promise<void> {
  const db = await openDb();
  if (!db || keys.length === 0) return;
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    keys.forEach(k => store.delete(k));
  } catch { /* storage unavailable */ }
}

/** Drops the least useful records once over the cap: dead first, then the stalest. */
export function enforceStreamCap(max = MAX_STREAM_RECORDS, batch = EVICT_BATCH): number {
  if (records.size <= max) return 0;
  const target = Math.max(0, max - batch);
  const order = Array.from(records.values()).sort((a, b) => {
    const dead = Number(b.status === 'dead') - Number(a.status === 'dead');
    return dead !== 0 ? dead : a.checkedAt - b.checkedAt;
  });
  const drop = order.slice(0, records.size - target).map(r => r.key);
  drop.forEach(k => records.delete(k));
  void removeFromDb(drop);
  return drop.length;
}

async function persist(record: StreamRecord<{ url: string }>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(record); } catch { /* storage unavailable */ }
}

async function hydrate(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => {
        for (const r of (req.result as StreamRecord<{ url: string }>[]) ?? []) {
          // Anything saved while loading (a lookup that finished first) is newer.
          if (r && typeof r.key === 'string' && !records.has(r.key)) records.set(r.key, r);
        }
        enforceStreamCap();
        resolve();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Resolves once the saved records are in memory. Starts loading on first import (app open). */
export const streamStoreReady: Promise<void> = hydrate();

/** The record for `key`, whatever its status. Synchronous once `streamStoreReady` has resolved. */
export function getStreamRecord<T extends { url: string }>(key: string): StreamRecord<T> | undefined {
  return records.get(key) as StreamRecord<T> | undefined;
}

/** The saved stream for `key` unless its link is known to be dead. */
export function getLiveStream<T extends { url: string }>(key: string): T | undefined {
  const r = records.get(key);
  return r && r.status !== 'dead' && r.value.url ? (r.value as T) : undefined;
}

/** Saves a freshly resolved stream (permanently). */
export function putStream<T extends { url: string }>(key: string, value: T, embeds: ExtractedStream[] = [], params?: Record<string, unknown>, links?: ExtractedStream[]): void {
  const now = Date.now();
  const previous = records.get(key);
  const record: StreamRecord<{ url: string }> = {
    key,
    value,
    params: params ?? previous?.params,
    // Keep embeds from earlier lookups when this one found none.
    embeds: embeds.length > 0 ? embeds : (previous?.embeds ?? []),
    savedAt: now,
    checkedAt: now,
    status: 'alive',
    // A new lookup's links replace the old ones (it asked every provider again); a save without
    // links (the played stream moved to another saved link) keeps them.
    links: links ? links.map(stream => ({ stream, status: 'alive' as const, checkedAt: now })) : previous?.links
  };
  records.set(key, record);
  void persist(record);
  enforceStreamCap();
}

/** Replaces a record's stream (e.g. late subtitles) without touching its check state. */
export function updateStreamValue<T extends { url: string }>(key: string, value: T): void {
  const r = records.get(key);
  if (!r) return;
  const next = { ...r, value };
  records.set(key, next);
  void persist(next);
}

/** Flags a link that stopped working. Kept, so the next lookup can replace it. */
export function markStreamDead(key: string): void {
  const r = records.get(key);
  if (!r || r.status === 'dead') return;
  const links = r.links?.map(l => (l.stream.url === r.value.url ? { ...l, status: 'dead' as const } : l));
  const next = { ...r, links, status: 'dead' as const, checkedAt: Date.now() };
  records.set(key, next);
  void persist(next);
}

/** Records the outcome of a link check. `alive: undefined` means it could not be judged. */
export function markStreamChecked(key: string, alive: boolean | undefined): void {
  const r = records.get(key);
  if (!r) return;
  const next = { ...r, checkedAt: Date.now(), status: alive === undefined ? r.status : alive ? ('alive' as const) : ('dead' as const) };
  records.set(key, next);
  void persist(next);
}

/** Records the check of one saved link (`alive: false` flags it dead); the played one's state follows. */
export function markLinkChecked(key: string, url: string, alive: boolean | undefined): void {
  const r = records.get(key);
  if (!r) return;
  const now = Date.now();
  const links = r.links?.map(l => l.stream.url !== url ? l : {
    ...l, checkedAt: now, status: alive === undefined ? l.status : alive ? ('alive' as const) : ('dead' as const)
  });
  const isValue = r.value.url === url;
  const next: StreamRecord<{ url: string }> = {
    ...r,
    links,
    ...(isValue ? { checkedAt: now, status: alive === undefined ? r.status : alive ? 'alive' as const : 'dead' as const } : {})
  };
  records.set(r.key, next);
  void persist(next);
}

/** Drops every record whose key does not start with `prefix` (saved by an older format). */
export function dropRecordsWithout(prefix: string): number {
  const stale = [...records.keys()].filter(k => !k.startsWith(prefix));
  stale.forEach(k => records.delete(k));
  void removeFromDb(stale);
  return stale.length;
}

export function allStreamRecords(): StreamRecord[] {
  return Array.from(records.values()) as unknown as StreamRecord[];
}

/** Saved stream links (every server's, not only the played ones) - what Settings shows. */
export function streamStoreSize(): number {
  let n = 0;
  for (const r of records.values()) n += r.links?.length || 1;
  return n;
}

/** Forgets every saved stream link (Settings > Clear Cache). */
export async function clearStreamStore(): Promise<void> {
  // A load still running would otherwise put the old records back.
  await streamStoreReady;
  records.clear();
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
