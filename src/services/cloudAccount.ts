// cloudAccount.ts - CineStream's account: what is synced between devices, and when.
import { createCloudSync } from './cloudSync.ts';
import { exportBackup, importBackup, subscribeLibraryChanges } from './historyService.ts';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || ({} as Record<string, string | undefined>);

export const cloud = createCloudSync({
  app: 'cinestream',
  url: env.VITE_SUPABASE_URL as string | undefined,
  anonKey: env.VITE_SUPABASE_ANON_KEY as string | undefined,
  collections: {
    // Continue Watching: one entry per title, the newest progress wins.
    history: { type: 'list', key: i => `${i.type}|${i.id}`, stamp: i => Number(i.lastWatchedAt) },
    bookmarks: { type: 'list', key: i => `${i.mediaType}|${i.id}` },
    // Progress of every episode watched, keyed "id|season|episode".
    episodeLog: { type: 'map', stamp: v => Number((v as { at?: number } | null)?.at) },
    preferences: { type: 'blob' }
  },
  read: async () => {
    const b = JSON.parse(exportBackup());
    return { history: b.history, bookmarks: b.bookmarks, episodeLog: b.episodeLog, preferences: b.preferences };
  },
  write: async state => { importBackup(JSON.stringify({ app: 'CineStream', ...state })); }
});

let started = false;
/** Syncs at launch, when the app comes back to the front, and a few seconds after anything changes. */
export function startCloudSync(): void {
  if (started || !cloud.getStatus().configured) return;
  started = true;
  subscribeLibraryChanges(() => cloud.schedule());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void cloud.syncNow(); });
  void cloud.syncNow();
}
