// fourProviders.test.ts - Vigorous verification of all 4 providers and stream resolution
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractorRegistry, ExtractorRegistry } from './extractorRegistry.ts';
import { MovierulzExtractor } from './movierulzExtractor.ts';
import { FlixeoExtractor } from './flixeoExtractor.ts';
import { VegaExtractor } from './vegaExtractor.ts';
import { CineHypeExtractor } from './cinehypeExtractor.ts';
import { resolveStream, forgetStream } from '../streamResolver.ts';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); }
};

beforeEach(() => {
  mem.clear();
});

test('all 4 providers are registered in the default extractor registry', () => {
  const all = extractorRegistry.getAllExtractors();
  const ids = all.map(e => e.id);
  assert.ok(ids.includes('movierulz'), 'movierulz is registered');
  assert.ok(ids.includes('flixeo'), 'flixeo is registered');
  assert.ok(ids.includes('vega'), 'vega is registered');
  assert.ok(ids.includes('cinehype'), 'cinehype is registered');
  assert.equal(all.length, 4, 'exactly 4 providers registered');
});

test('each extractor returns valid stream metadata for movies and TV', async () => {
  const movierulz = new MovierulzExtractor();
  const flixeo = new FlixeoExtractor();
  const vega = new VegaExtractor();
  const cinehype = new CineHypeExtractor();

  // Test Movie extraction fallback/direct URLs
  const mMovie = await movierulz.extract({ id: 550, type: 'movie' });
  assert.ok(mMovie && mMovie.url.includes('550'), 'Movierulz movie URL valid');
  assert.equal(mMovie?.serverId, 'movierulz');
  assert.equal(mMovie?.serverName, 'Movierulz Regional');

  const fMovie = await flixeo.extract({ id: 550, type: 'movie' });
  assert.ok(fMovie && fMovie.url.includes('550'), 'Flixeo movie URL valid');
  assert.equal(fMovie?.serverId, 'flixeo');
  assert.equal(fMovie?.serverName, 'Flixeo Server');

  const vMovie = await vega.extract({ id: 550, type: 'movie' });
  assert.ok(vMovie && vMovie.url.includes('550'), 'Vega movie URL valid');
  assert.equal(vMovie?.serverId, 'vega');
  assert.equal(vMovie?.serverName, 'Vega Engine');

  const cMovie = await cinehype.extract({ id: 550, type: 'movie' });
  assert.ok(cMovie && cMovie.url.includes('550'), 'CineHype movie URL valid');
  assert.equal(cMovie?.serverId, 'cinehype');
  assert.equal(cMovie?.serverName, 'CineHype Server');

  // Test TV extraction
  const mTv = await movierulz.extract({ id: 1399, type: 'tv', season: 1, episode: 1 });
  assert.ok(mTv && mTv.url.includes('1399'), 'Movierulz TV URL valid');

  const fTv = await flixeo.extract({ id: 1399, type: 'tv', season: 1, episode: 1 });
  assert.ok(fTv && fTv.url.includes('1399'), 'Flixeo TV URL valid');

  const vTv = await vega.extract({ id: 1399, type: 'tv', season: 1, episode: 1 });
  assert.ok(vTv && vTv.url.includes('1399'), 'Vega TV URL valid');

  const cTv = await cinehype.extract({ id: 1399, type: 'tv', season: 1, episode: 1 });
  assert.ok(cTv && cTv.url.includes('1399'), 'CineHype TV URL valid');
});

test('resolveAllStreams provides stream data from all 4 providers on web', async () => {
  const reg = new ExtractorRegistry(true);
  const streams = await reg.resolveAllStreams({
    id: 550,
    type: 'movie',
    directOnly: false,
    fresh: true
  });

  const ids = streams.map(s => s.serverId);
  assert.ok(ids.includes('movierulz'), 'movierulz stream data resolved');
  assert.ok(ids.includes('flixeo'), 'flixeo stream data resolved');
  assert.ok(ids.includes('vega'), 'vega stream data resolved');
  assert.ok(ids.includes('cinehype'), 'cinehype stream data resolved');
});

test('resolveBestStream correctly honors user preferredServerId for each of the 4 providers', async () => {
  const reg = new ExtractorRegistry(true);
  const all = await reg.resolveAllStreams({ id: 550, type: 'movie', directOnly: false, fresh: true });

  for (const targetId of ['movierulz', 'flixeo', 'vega', 'cinehype']) {
    const best = await reg.resolveBestStream({
      id: 550,
      type: 'movie',
      preferredServerId: targetId
    }, all);
    assert.equal(best?.serverId, targetId, `Switching to ${targetId} returns ${targetId} stream`);
  }
});

test('streamResolver exposes all 4 servers in availableServers and allows switching', async () => {
  const params = { id: 680, type: 'movie' as const };
  forgetStream(params);

  const res = await resolveStream(params, { fresh: true });
  assert.ok(res.url, 'Stream URL returned');
  assert.ok(res.availableServers, 'availableServers list provided');
  assert.equal(res.availableServers?.length, 4, 'All 4 servers exposed in availableServers');

  const serverIds = res.availableServers?.map(s => s.serverId);
  assert.deepEqual(serverIds?.sort(), ['cinehype', 'flixeo', 'movierulz', 'vega'].sort());

  // Test selecting vega specifically
  const vegaRes = await resolveStream({ ...params, preferredServerId: 'vega' }, { fresh: true });
  assert.equal(vegaRes.serverId, 'vega');
  assert.ok(vegaRes.url.includes('680'), 'Vega stream URL resolves for movie 680');

  // Test selecting cinehype specifically
  const cinehypeRes = await resolveStream({ ...params, preferredServerId: 'cinehype' }, { fresh: true });
  assert.equal(cinehypeRes.serverId, 'cinehype');
  assert.ok(cinehypeRes.url.includes('680'), 'CineHype stream URL resolves for movie 680');

  // Test selecting flixeo specifically
  const flixeoRes = await resolveStream({ ...params, preferredServerId: 'flixeo' }, { fresh: true });
  assert.equal(flixeoRes.serverId, 'flixeo');
  assert.ok(flixeoRes.url.includes('680'), 'Flixeo stream URL resolves for movie 680');

  // Test selecting movierulz specifically
  const movierulzRes = await resolveStream({ ...params, preferredServerId: 'movierulz' }, { fresh: true });
  assert.equal(movierulzRes.serverId, 'movierulz');
  assert.ok(movierulzRes.url.includes('680'), 'Movierulz stream URL resolves for movie 680');
});

test('application automatically selects the best server without manual input', async () => {
  const params = { id: 27205, type: 'movie' as const };
  forgetStream(params);

  // Default call with no preferredServerId specified
  const autoRes = await resolveStream(params, { fresh: true });
  assert.ok(autoRes.url, 'Stream URL returned automatically');
  assert.ok(autoRes.serverId, 'Server selected automatically');
  assert.ok(['movierulz', 'flixeo', 'vega', 'cinehype'].includes(autoRes.serverId!), 'Server is one of the 4 providers');

  // Test automatic failover when primary server is excluded
  const failoverRes = await resolveStream({ ...params, exclude: [autoRes.serverId!] }, { fresh: true });
  assert.ok(failoverRes.url, 'Stream URL returned on automatic failover');
  assert.notEqual(failoverRes.serverId, autoRes.serverId, 'Automatically failed over to a different server');
});


