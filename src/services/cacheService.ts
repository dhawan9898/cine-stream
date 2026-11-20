// cacheService.ts - Settings > Clear Cache: everything the app keeps only to be faster or to work
// offline, in every layer it is kept in.
//
// Cleared: lists / details / artwork (tiered cache + IndexedDB page cache), saved stream links (memory
// and IndexedDB), title-id maps and search results of the scraping sources, which provider played
// each title last, and the WebView's disk cache (artwork) on Android.
// Kept: watch history, My List, settings, downloads, the account, and the learned provider health
// (which only skips broken providers; it is not a copy of any content).
import { Capacitor } from '@capacitor/core';
import { clearPersistedCache } from './persistentCache.ts';
import { cacheClear } from './offlineStore.ts';
import { clearStreamStore } from '../providers/service/streamStore.ts';
import { clearResolvedStreams } from '../providers/service/resolver.ts';
import { TtlStore } from '../providers/core/ttlStore.ts';
import { extractorRegistry } from '../providers/engine/registry.ts';
import { ExoPlayerPlugin } from '../plugins/exoPlayerPlugin.ts';

// Older caches the current ones replaced, still on devices that updated.
const LEGACY_PREFIXES = ['cinestream_stale_'];

export async function clearAllCaches(): Promise<void> {
  clearPersistedCache();
  clearResolvedStreams();
  TtlStore.clearAll();
  extractorRegistry.forgetLastGood();
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && LEGACY_PREFIXES.some(p => k.startsWith(p))) stale.push(k);
    }
    stale.forEach(k => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
  await Promise.all([
    cacheClear(),
    clearStreamStore(),
    Capacitor.isNativePlatform()
      ? ExoPlayerPlugin.clearWebCache().catch(() => undefined) // an older native build: nothing to clear
      : Promise.resolve()
  ]);
}
