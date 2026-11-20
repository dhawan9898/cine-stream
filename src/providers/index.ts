// index.ts - What the rest of the app may use from the provider layer. Nothing outside src/providers
// imports a file inside it directly, so the layers below can change without touching the screens.
//
//   core/     types, manifests, the HTTP client and per-host limits, stream facts, language/print rules,
//             remote config
//   sources/  one file per site (how to get a stream for a title there)
//   engine/   the registry, the lookup planner and race, the sniffer queue, the stream election
//   service/  the resolver (this API), saved links, background scheduling, speculation, revalidation,
//             subtitles, timings
import { clearHttpMemo } from './core/http.ts';
import { TtlStore } from './core/ttlStore.ts';
import { extractorRegistry } from './engine/registry.ts';
import { clearResolvedStreams } from './service/resolver.ts';
import { clearStreamStore } from './service/streamStore.ts';
import { JellyfinSource } from './sources/jellyfin.ts';

export {
  Priority, forgetStream, prefetchStream, prefetchUpcomingEpisodes, refreshSavedStream, resolveStream, warmStreams,
  type ResolvedStream, type StreamParams
} from './service/resolver.ts';
export { streamStoreSize } from './service/streamStore.ts';
export { setStreamPlaying, startStreamRevalidator } from './service/revalidator.ts';
export { initSpeculation } from './service/speculation.ts';
export { clearTimings, formatTimingReport, getTimings, summarize } from './service/timings.ts';
export { loadProviderConfig } from './core/providerConfig.ts';
export { LANGUAGE_NAMES } from './core/language.ts';
export type { ExtractedStream, ExtractorSubtitle } from './core/types.ts';

/**
 * Forgets everything the provider layer keeps only to be faster (Settings > Clear Cache): saved links,
 * lookups in memory, title-id maps and search results of the scraping sources, which provider played
 * each title, memoised requests. The learned provider health stays: it is not a copy of any content.
 */
export async function clearProviderCaches(): Promise<void> {
  clearResolvedStreams();
  clearHttpMemo();
  TtlStore.clearAll();
  extractorRegistry.forgetLastGood();
  await clearStreamStore();
}

/** Settings > Sources > Jellyfin "Test": the server's name, or what went wrong. */
export function testJellyfinConnection(): Promise<{ ok: boolean; message: string }> {
  return new JellyfinSource().testConnection();
}
