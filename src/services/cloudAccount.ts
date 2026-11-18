// cloudAccount.ts - CineStream's account: what is synced between devices, and when.
import { Capacitor } from '@capacitor/core';
import { createCloudSync } from './cloudSync.ts';
import { ExoPlayerPlugin } from '../plugins/exoPlayerPlugin.ts';
import { exportBackup, importBackup, subscribeLibraryChanges } from './historyService.ts';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || ({} as Record<string, string | undefined>);

// The player's Enhance settings live in native preferences; on the web there are none.
async function readEnhance(): Promise<string | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined;
  try { return (await ExoPlayerPlugin.getEnhancePrefs()).json; } catch { return undefined; }
}

async function writeEnhance(json: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try { await ExoPlayerPlugin.setEnhancePrefs({ json }); } catch { /* an older native build: ignore */ }
}

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
    preferences: { type: 'blob' },
    // Player Enhance settings (sharpening, glow, colour, audio, subtitle look), native only.
    enhance: { type: 'blob' }
  },
  read: async () => {
    const b = JSON.parse(exportBackup());
    const state: Record<string, unknown> = { history: b.history, bookmarks: b.bookmarks, episodeLog: b.episodeLog, preferences: b.preferences };
    const enhance = await readEnhance();
    if (enhance !== undefined) state.enhance = enhance;
    return state;
  },
  write: async state => {
    const { enhance, ...rest } = state;
    importBackup(JSON.stringify({ app: 'CineStream', ...rest }));
    if (typeof enhance === 'string') await writeEnhance(enhance);
  }
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
