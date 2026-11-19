import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); }
};

const { saveWatchProgress, getEpisodeProgress, episodeWatchState, isEpisodeFinished, clearWatchHistory, removeWatchHistory, getEpisodeLogCount, getWatchHistory } = await import('./historyService.ts');
const { applyPreferredQuality } = await import('./playbackPrefs.ts');

const media = { id: 7, title: 'Show', mediaType: 'tv' as const, poster: '', backdrop: '', overview: '', releaseDate: '', voteAverage: 0 };

beforeEach(() => { mem.clear(); clearWatchHistory(); });

test('tracks progress per episode, not just the latest one', () => {
  saveWatchProgress({ media, season: 1, episode: 1, progressPercent: 99, positionMs: 2_990_000, durationMs: 3_000_000 });
  saveWatchProgress({ media, season: 1, episode: 2, progressPercent: 40, positionMs: 1_200_000, durationMs: 3_000_000 });
  const p = getEpisodeProgress(7);
  assert.equal(episodeWatchState(p['1|1']), 'finished');
  assert.equal(episodeWatchState(p['1|2']), 'partial');
  assert.equal(episodeWatchState(p['1|3']), 'unwatched');
});

test('an episode within 30s of the end counts as finished', () => {
  assert.ok(isEpisodeFinished({ positionMs: 2_975_000, durationMs: 3_000_000 }));
  assert.ok(!isEpisodeFinished({ positionMs: 600_000, durationMs: 3_000_000 }));
});

test('default quality picks the matching rendition, Auto keeps the stream', () => {
  const picked = { url: 'a.m3u8', qualities: [{ quality: '720p', url: 'b.m3u8' }, { quality: '1080p', url: 'a.m3u8' }] };
  assert.equal(applyPreferredQuality(picked, '720p').url, 'b.m3u8');
  assert.equal(applyPreferredQuality(picked, 'Auto').url, 'a.m3u8');
  assert.equal(applyPreferredQuality(picked, '480p').url, 'a.m3u8');
});

test('removeWatchHistory clears both continue watching and episode log for that title', () => {
  const otherMedia = { id: 99, title: 'Other', mediaType: 'tv' as const, poster: '', backdrop: '', overview: '', releaseDate: '', voteAverage: 0 };
  saveWatchProgress({ media, season: 1, episode: 1, progressPercent: 99, positionMs: 2_990_000, durationMs: 3_000_000 });
  saveWatchProgress({ media, season: 1, episode: 2, progressPercent: 50, positionMs: 1_500_000, durationMs: 3_000_000 });
  saveWatchProgress({ media: otherMedia, season: 2, episode: 1, progressPercent: 80, positionMs: 2_400_000, durationMs: 3_000_000 });

  assert.equal(getWatchHistory().length, 2);
  assert.equal(getEpisodeLogCount(), 3);
  assert.equal(Object.keys(getEpisodeProgress(7)).length, 2);

  removeWatchHistory(7, 'tv');

  assert.equal(getWatchHistory().length, 1);
  assert.equal(getWatchHistory()[0].id, 99);
  assert.equal(Object.keys(getEpisodeProgress(7)).length, 0);
  assert.equal(Object.keys(getEpisodeProgress(99)).length, 1);
  assert.equal(getEpisodeLogCount(), 1);
});

test('clearWatchHistory completely wipes history and all episode progress', () => {
  saveWatchProgress({ media, season: 1, episode: 1, progressPercent: 99, positionMs: 2_990_000, durationMs: 3_000_000 });
  saveWatchProgress({ media, season: 1, episode: 2, progressPercent: 50, positionMs: 1_500_000, durationMs: 3_000_000 });

  assert.ok(getWatchHistory().length > 0);
  assert.ok(getEpisodeLogCount() > 0);

  clearWatchHistory();

  assert.equal(getWatchHistory().length, 0);
  assert.equal(getEpisodeLogCount(), 0);
  assert.deepEqual(getEpisodeProgress(7), {});
});
