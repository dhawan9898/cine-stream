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

// Stub every extractor: `direct` ids return a playable m3u8, the rest return only an embed page.
function stubExtractors(direct: string[]) {
  const proto = [MovierulzExtractor, FlixeoExtractor, VegaExtractor, CineHypeExtractor];
  const originals = proto.map(C => C.prototype.extract);
  proto.forEach(C => {
    C.prototype.extract = async function (this: { id: string; name: string }, p: { id: number }) {
      return direct.includes(this.id)
        ? { url: `https://cdn.test/${this.id}/${p.id}/index.m3u8`, format: 'hls' as const, serverId: this.id, serverName: this.name }
        : { url: `https://embed.test/${this.id}/${p.id}`, format: 'hls' as const, isFallbackEmbed: true, serverId: this.id, serverName: this.name };
    } as typeof C.prototype.extract;
  });
  return () => proto.forEach((C, i) => { C.prototype.extract = originals[i]; });
}

test('resolveAllStreams returns direct streams only, never embed pages', async () => {
  const restore = stubExtractors(['vega', 'flixeo']);
  try {
    const reg = new ExtractorRegistry(true);
    const streams = await reg.resolveAllStreams({ id: 550, type: 'movie', directOnly: false, fresh: true });
    assert.deepEqual(streams.map(s => s.serverId).sort(), ['flixeo', 'vega']);
    assert.ok(streams.every(s => !s.isFallbackEmbed && s.url.endsWith('.m3u8')));
  } finally { restore(); }
});

test('resolveBestStream honors preferredServerId among direct streams and ignores embeds', async () => {
  const restore = stubExtractors(['movierulz', 'flixeo', 'vega', 'cinehype']);
  try {
    const reg = new ExtractorRegistry(true);
    const all = await reg.resolveAllStreams({ id: 550, type: 'movie', fresh: true });
    for (const targetId of ['movierulz', 'flixeo', 'vega', 'cinehype']) {
      const best = await reg.resolveBestStream({ id: 550, type: 'movie', preferredServerId: targetId }, all);
      assert.equal(best?.serverId, targetId);
    }
    const embedOnly = [{ url: 'https://embed.test/x', format: 'hls' as const, isFallbackEmbed: true, serverId: 'vega' }];
    assert.equal(await reg.resolveBestStream({ id: 1, type: 'movie' }, embedOnly), null);
  } finally { restore(); }
});

test('streamResolver exposes all servers, switches server, and fails over', async () => {
  const restore = stubExtractors(['movierulz', 'flixeo', 'vega', 'cinehype']);
  try {
    const params = { id: 680, type: 'movie' as const };
    forgetStream(params);
    const res = await resolveStream(params, { fresh: true });
    assert.ok(res.url.endsWith('.m3u8') && !res.isFallbackEmbed);
    assert.deepEqual(res.availableServers?.map(s => s.serverId).sort(), ['cinehype', 'flixeo', 'movierulz', 'vega']);

    for (const id of ['vega', 'cinehype', 'flixeo', 'movierulz']) {
      const r = await resolveStream({ ...params, preferredServerId: id }, { fresh: true });
      assert.equal(r.serverId, id);
      assert.ok(r.url.includes('680'));
    }

    const failover = await resolveStream({ ...params, exclude: [res.serverId!] }, { fresh: true });
    assert.notEqual(failover.serverId, res.serverId);
  } finally { restore(); }
});

test('streamResolver rejects instead of returning an embed/iframe page', async () => {
  const restore = stubExtractors([]);
  try {
    const params = { id: 27205, type: 'movie' as const };
    forgetStream(params);
    await assert.rejects(resolveStream(params, { fresh: true }), /No working stream/);
  } finally { restore(); }
});

test('every direct stream found is cached, so switching server needs no new lookup', async () => {
  const restore = stubExtractors(['movierulz', 'flixeo', 'vega', 'cinehype']);
  const params = { id: 4242, type: 'movie' as const };
  forgetStream(params);
  try {
    await resolveStream(params, { fresh: true });
  } finally { restore(); }
  // Providers now return nothing playable: only the cache can answer.
  const offline = stubExtractors([]);
  try {
    for (const id of ['vega', 'cinehype', 'flixeo', 'movierulz']) {
      const r = await resolveStream({ ...params, preferredServerId: id }).catch(e => { throw new Error(id + ': ' + e.message); });
      assert.equal(r.serverId, id);
      assert.ok(!r.isFallbackEmbed && r.url.includes('4242'));
    }
  } finally { offline(); }
});

test('a stale saved link that stopped answering fails over to another saved server, no new lookup', async () => {
  const { getStreamRecord } = await import('../streamStore.ts');
  const restore = stubExtractors(['vega', 'flixeo', 'cinehype', 'movierulz']);
  const params = { id: 5151, type: 'movie' as const };
  forgetStream(params);
  let first: Awaited<ReturnType<typeof resolveStream>>;
  try { first = await resolveStream(params, { fresh: true }); } finally { restore(); }

  // Age the saved entry and make its link (only) answer 404.
  const key = Array.from((await import('../streamStore.ts')).allStreamRecords()).find(r => r.value.url === first.url && !(r.params as { preferredServerId?: string })?.preferredServerId)!.key;
  (getStreamRecord(key) as { checkedAt: number }).checkedAt = Date.now() - 3 * 3600 * 1000;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => (String(url) === first.url ? { ok: false, status: 404 } : { ok: true, status: 206 })) as unknown as typeof fetch;
  const offline = stubExtractors([]); // a new lookup would fail: only saved links can answer
  try {
    const second = await resolveStream(params);
    assert.notEqual(second.url, first.url);
    assert.ok(!second.isFallbackEmbed && second.url.includes('5151'));
    // The title's own entry now points at the working server.
    assert.equal((await resolveStream(params)).url, second.url);
  } finally { offline(); globalThis.fetch = realFetch; }
});

test('a title every provider failed for is not prefetched again for a while', async () => {
  const { prefetchStream } = await import('../streamResolver.ts');
  const restore = stubExtractors([]);
  const params = { id: 6262, type: 'movie' as const };
  forgetStream(params);
  let calls = 0;
  const proto = [MovierulzExtractor, FlixeoExtractor, VegaExtractor, CineHypeExtractor];
  const wrapped = proto.map(C => C.prototype.extract);
  proto.forEach((C, i) => { C.prototype.extract = (async function (this: unknown, p: unknown) { calls++; return wrapped[i].call(this as never, p as never); }) as typeof C.prototype.extract; });
  try {
    await assert.rejects(resolveStream(params, { fresh: true }), /No working stream/);
    const after = calls;
    prefetchStream(params);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(calls, after, 'no new provider calls for a title that just failed');
  } finally { proto.forEach((C, i) => { C.prototype.extract = wrapped[i]; }); restore(); }
});
