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
