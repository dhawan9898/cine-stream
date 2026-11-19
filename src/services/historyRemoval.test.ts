// A title removed from history (Continue Watching ✕, Clear Watch History) must stay removed: a cloud
// sync or another device that still has the old copy must not bring it back.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); }
};

const H = await import('./historyService.ts');

let clock = 1_000_000;
const realNow = Date.now;
Date.now = () => clock;
const tick = (ms = 1000) => { clock += ms; };

const film = { id: 11, title: 'Film', mediaType: 'movie' as const, poster: '', backdrop: '', overview: '', releaseDate: '', voteAverage: 0 };
const show = { ...film, id: 22, title: 'Show', mediaType: 'tv' as const };
const watch = (m: typeof film | typeof show) => H.saveWatchProgress({ media: m, season: m.mediaType === 'tv' ? 1 : undefined, episode: m.mediaType === 'tv' ? 1 : undefined, progressPercent: 40, positionMs: 600_000, durationMs: 1_500_000 });
/** What a sync that read the state before the change would write back. */
const staleSnapshot = () => JSON.parse(H.exportBackup()) as H.BackupData;

beforeEach(() => { mem.clear(); H.importBackup(JSON.stringify({ app: 'CineStream', history: [], episodeLog: {} })); tick(); });

test('a title removed with ✕ is not brought back by a sync that still had it', () => {
  watch(film); tick(); watch(show); tick();
  const stale = staleSnapshot();
  H.removeWatchHistory(show.id, 'tv');
  tick();
  H.applySyncedState({ ...stale, historyRemoved: {} });
  assert.deepEqual(H.getWatchHistory().map(h => h.id), [film.id]);
  assert.equal(H.getMediaWatchHistory(show.id, 'tv'), undefined, 'the title page shows no Resume');
  assert.deepEqual(H.getEpisodeProgress(show.id), {}, 'no episodes marked watched');
});

test('Clear Watch History is not undone by the cloud copy', () => {
  watch(film); tick(); watch(show); tick();
  const stale = staleSnapshot();
  H.clearWatchHistory();
  tick();
  H.applySyncedState({ ...stale, historyRemoved: {} });
  assert.deepEqual(H.getWatchHistory(), []);
  assert.equal(H.getEpisodeLogCount(), 0);
});

test('a removal synced from another device removes the title here', () => {
  watch(film); tick(); watch(show); tick();
  const here = staleSnapshot();
  H.applySyncedState({ ...here, historyRemoved: { 'movie|11': clock } });
  assert.deepEqual(H.getWatchHistory().map(h => h.id), [show.id]);
  tick();
  H.applySyncedState({ ...staleSnapshot(), historyRemoved: { '*': clock } });
  assert.deepEqual(H.getWatchHistory(), [], 'history cleared on the other device');
});

test('watching a removed title again brings it back, and the old removal does not hide it', () => {
  watch(film); tick();
  H.removeWatchHistory(film.id, 'movie');
  tick();
  watch(film); tick();
  H.applySyncedState(staleSnapshot());
  assert.deepEqual(H.getWatchHistory().map(h => h.id), [film.id]);
});

test('removing a movie keeps the episode progress of a series with the same id', () => {
  const twin = { ...show, id: film.id };
  watch(film); tick(); watch(twin); tick();
  H.removeWatchHistory(film.id, 'movie');
  assert.ok(Object.keys(H.getEpisodeProgress(film.id)).length > 0);
});

test('restoring a backup file brings its titles back, even ones removed since', () => {
  watch(film); tick();
  const backup = H.exportBackup();
  H.clearWatchHistory(); tick();
  H.importBackup(backup);
  assert.deepEqual(H.getWatchHistory().map(h => h.id), [film.id]);
  tick();
  H.applySyncedState(staleSnapshot());
  assert.deepEqual(H.getWatchHistory().map(h => h.id), [film.id], 'and the next sync keeps them');
});

test.after(() => { Date.now = realNow; });
