// Unit tests for the TMDB client: key handling, response mapping, and the
// "offline shows the last good list" path. fetch and localStorage are faked.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; }
};
// Object.keys(localStorage) is used by the cache code, so mirror entries on the object.
const ls = (globalThis as unknown as { localStorage: Record<string, unknown> }).localStorage;
const origSet = ls.setItem as (k: string, v: string) => void;
const origRemove = ls.removeItem as (k: string) => void;
ls.setItem = (k: string, v: string) => { origSet(k, v); ls[k] = v; };
ls.removeItem = (k: string) => { origRemove(k); delete ls[k]; };

let urls: string[] = [];
let respondWith: () => Promise<Response>;

beforeEach(() => {
  urls = [];
  for (const k of [...store.keys()]) ls.removeItem && (ls.removeItem as (k: string) => void)(k);
  globalThis.fetch = ((url: string) => { urls.push(String(url)); return respondWith(); }) as typeof fetch;
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

test('throws a clear error when the TMDB key is not configured', async () => {
  delete process.env.VITE_TMDB_API_KEY;
  const core = await import('./cineHypeCore.ts?nokey');
  respondWith = () => json({ results: [] });
  await assert.rejects(core.searchMedia('matrix'), /TMDB API key is missing/);
  assert.equal(urls.length, 0, 'must not hit the network without a key');
});

test('maps search results and drops people / posterless entries', async () => {
  process.env.VITE_TMDB_API_KEY = 'test-key';
  const core = await import('./cineHypeCore.ts?withkey');
  respondWith = () => json({
    results: [
      { id: 1, media_type: 'movie', title: 'The Matrix', poster_path: '/m.jpg', release_date: '1999-03-31', vote_average: 8.2345 },
      { id: 2, media_type: 'tv', name: 'Show', backdrop_path: '/b.jpg', first_air_date: '2020-01-01' },
      { id: 3, media_type: 'person', name: 'Someone', poster_path: '/p.jpg' },
      { id: 4, media_type: 'movie', title: 'No Art' }
    ]
  });
  const items = await core.searchMedia('matrix');
  assert.deepEqual(items.map(i => [i.id, i.mediaType, i.title]), [[1, 'movie', 'The Matrix'], [2, 'tv', 'Show']]);
  assert.equal(items[0].voteAverage, 8.2);
  assert.match(urls[0], /api_key=test-key/);
});

test('does not retry a non-retryable 4xx and surfaces the error', async () => {
  process.env.VITE_TMDB_API_KEY = 'test-key';
  const core = await import('./cineHypeCore.ts?withkey');
  respondWith = () => json({}, 404);
  await assert.rejects(core.searchMedia('zzz-unique-404'), /404/);
  assert.equal(urls.length, 1);
});

test('posterSrcSet offers w185/w342/w500 for TMDB posters and leaves other URLs alone', async () => {
  process.env.VITE_TMDB_API_KEY = 'test-key';
  const core = await import('./cineHypeCore.ts?withkey');
  const r = core.posterSrcSet('https://image.tmdb.org/t/p/w500/abc.jpg');
  assert.equal(r.src, 'https://image.tmdb.org/t/p/w342/abc.jpg');
  assert.match(r.srcSet!, /w185\/abc\.jpg 185w, .*w342\/abc\.jpg 342w, .*w500\/abc\.jpg 500w/);
  assert.deepEqual(core.posterSrcSet('https://example.com/p.jpg'), { src: 'https://example.com/p.jpg' });
  assert.deepEqual(core.posterSrcSet(''), { src: '' });
});

test('search: known titles first, unrated ones only when they are what was typed', async () => {
  const { rankSearchResults } = await import('./cineHypeCore.ts');
  const m = (title: string, voteCount: number) => ({ id: title.length, title, voteCount }) as unknown as import('./cineHypeCore.ts').MediaItem;
  const out = rankSearchResults([m('Interstellar Wanderer', 3), m('Interstellar', 38000), m('Lolita from Interstellar Space', 0), m('Interstellar', 0), m('Inside Interstellar', 40)], 'interstellar');
  assert.deepEqual(out.map(x => `${x.title}:${x.voteCount}`), ['Interstellar:38000', 'Inside Interstellar:40', 'Interstellar Wanderer:3', 'Interstellar:0']);
});

test('release filter: past and today are released, future / missing / malformed are not', async () => {
  process.env.VITE_TMDB_API_KEY = 'test-key';
  const core = await import('./cineHypeCore.ts?withkey');
  const today = '2026-11-19';
  assert.equal(core.isReleased('2026-11-18', today), true);
  assert.equal(core.isReleased('2026-11-19', today), true);
  assert.equal(core.isReleased('2026-11-20', today), false);
  assert.equal(core.isReleased('', today), false);
  assert.equal(core.isReleased(undefined, today), false);
  assert.equal(core.isReleased('TBA', today), false);
  assert.equal(core.todayISO(new Date(2026, 0, 5)), '2026-01-05');
});

test('lists, search and discover leave out titles that are not out yet', async () => {
  process.env.VITE_TMDB_API_KEY = 'test-key';
  const core = await import('./cineHypeCore.ts?withkey');
  const results = [
    { id: 11, media_type: 'movie', title: 'Out', poster_path: '/a.jpg', release_date: '2000-01-01', vote_count: 50 },
    { id: 12, media_type: 'movie', title: 'Out Later', poster_path: '/b.jpg', release_date: '2999-01-01', vote_count: 50 },
    { id: 13, media_type: 'movie', title: 'Undated', poster_path: '/c.jpg', vote_count: 50 }
  ];
  respondWith = () => json({ results });
  assert.deepEqual((await core.getTrending('movie')).map(i => i.id), [11]);
  assert.deepEqual((await core.searchMedia('out')).map(i => i.id), [11]);
  assert.deepEqual((await core.discoverMedia({ type: 'movie', language: 'te', sortBy: 'primary_release_date.desc' })).map(i => i.id), [11]);
  assert.match(urls.at(-1)!, /primary_release_date\.lte=\d{4}-\d{2}-\d{2}/);
  await core.discoverMedia({ type: 'tv', language: 'te' });
  assert.match(urls.at(-1)!, /first_air_date\.lte=/);
});

test('unaired episodes and seasons are hidden', async () => {
  process.env.VITE_TMDB_API_KEY = 'test-key';
  const core = await import('./cineHypeCore.ts?withkey');
  respondWith = () => json({ episodes: [
    { id: 1, episode_number: 1, season_number: 1, air_date: '2020-01-01' },
    { id: 2, episode_number: 2, season_number: 1, air_date: '2999-01-01' },
    { id: 3, episode_number: 3, season_number: 1 }
  ] });
  assert.deepEqual((await core.getTVSeasonEpisodes(77, 1)).map(e => e.episodeNumber), [1]);

  respondWith = () => json({ id: 77, name: 'Show', first_air_date: '2020-01-01', poster_path: '/s.jpg', seasons: [
    { id: 1, season_number: 1, name: 'S1', episode_count: 8, air_date: '2020-01-01' },
    { id: 2, season_number: 2, name: 'S2', episode_count: 8, air_date: '2999-01-01' }
  ] });
  const d = await core.getMediaDetails(77, 'tv');
  assert.deepEqual(d.seasons?.map(s => s.seasonNumber), [1]);
});
