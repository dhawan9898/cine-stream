// Behaviour of the provider race: early exit, health cooldown, remembered provider.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { StreamExtractor, ExtractedStream } from './types.ts';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); }
};

const { ExtractorRegistry } = await import('./extractorRegistry.ts');

const direct = (url: string): ExtractedStream => ({ url, format: 'hls' });
const fake = (id: string, run: () => Promise<ExtractedStream | null>): StreamExtractor & { calls: number } => {
  const e = { id, name: id, mainUrl: `https://${id}`, calls: 0, extract() { e.calls++; return run(); } };
  return e;
};
const delay = <T,>(ms: number, v: T) => new Promise<T>(r => setTimeout(() => r(v), ms));
const params = { id: 1, type: 'movie' as const, directOnly: true, allowSniff: false };

beforeEach(() => mem.clear());

test('returns as soon as a direct stream lands, without waiting for slow providers', async () => {
  const reg = new ExtractorRegistry(false);
  const fast = fake('fast', () => delay(10, direct('https://fast/a.m3u8')));
  const slow = fake('slow', () => delay(3000, direct('https://slow/a.m3u8')));
  reg.register(slow); reg.register(fast);
  const t0 = Date.now();
  const out = await reg.resolveAllStreams(params);
  assert.ok(Date.now() - t0 < 1500, 'early exit should not wait for the slow provider');
  assert.equal(out[0].serverId, 'fast');
});

test('a provider that fails 3 times in a row is put on cooldown', async () => {
  const reg = new ExtractorRegistry(false);
  const bad = fake('bad', async () => null);
  const good = fake('good', async () => direct('https://good/a.m3u8'));
  reg.register(bad); reg.register(good);
  for (let i = 0; i < 3; i++) await reg.resolveAllStreams({ ...params, id: i + 10, fresh: true });
  assert.equal(bad.calls, 3);
  await reg.resolveAllStreams({ ...params, id: 99, fresh: true });
  assert.equal(bad.calls, 3, 'cooling-down provider is skipped');
});

test('the provider that worked last time is tried alone first', async () => {
  const reg = new ExtractorRegistry(false);
  const a = fake('a', async () => direct('https://a/x.m3u8'));
  const b = fake('b', async () => direct('https://b/x.m3u8'));
  reg.register(a); reg.register(b);
  await reg.resolveAllStreams({ ...params, preferredServerId: undefined });
  const remembered = (await reg.resolveAllStreams(params))[0].serverId!;
  const before = { a: a.calls, b: b.calls };
  await reg.resolveAllStreams(params);
  const after = { a: a.calls, b: b.calls };
  const called = (['a', 'b'] as const).filter(k => after[k] > before[k]);
  assert.deepEqual(called, [remembered], 'only the remembered provider is queried');
});

// ---- embed pages are sniffed as soon as their provider answers -------------

const embed = (id: string): ExtractedStream => ({ url: `https://${id}/embed/1`, format: 'hls', isFallbackEmbed: true, serverId: id });
const sniffParams = { id: 1, type: 'movie' as const, directOnly: true, allowSniff: true };

test('an embed is sniffed at once, without waiting for the slowest provider', async () => {
  const reg = new ExtractorRegistry(false);
  reg.register(fake('quick', async () => embed('quick')));
  reg.register(fake('stuck', () => delay(5000, null)));
  reg.setSniffer(async e => (e.serverId === 'quick' ? direct('https://cdn/quick.m3u8') : null));
  const t0 = Date.now();
  const out = await reg.resolveAllStreams(sniffParams);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'https://cdn/quick.m3u8');
  assert.equal(out[0].serverId, 'quick');
});

test('two embeds are sniffed in parallel: a slow one does not hold up a fast one', async () => {
  const reg = new ExtractorRegistry(false);
  reg.register(fake('slowpage', async () => embed('slowpage')));
  reg.register(fake('fastpage', async () => embed('fastpage')));
  reg.setSniffer(async e => (e.serverId === 'slowpage' ? delay(3000, direct('https://cdn/slow.m3u8')) : delay(50, direct('https://cdn/fast.m3u8'))));
  const t0 = Date.now();
  const out = await reg.resolveAllStreams(sniffParams);
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0}ms`);
  assert.equal(out[0].serverId, 'fastpage');
});

test('health follows the sniff result, not the embed page', async () => {
  const reg = new ExtractorRegistry(false);
  const dead = fake('dead', async () => embed('dead'));
  const live = fake('live', async () => embed('live'));
  reg.register(dead); reg.register(live);
  reg.setSniffer(async e => (e.serverId === 'live' ? direct('https://cdn/live.m3u8') : null));
  for (let i = 0; i < 3; i++) await reg.resolveAllStreams({ ...sniffParams, id: 20 + i, fresh: true });
  assert.equal(dead.calls, 3);
  await reg.resolveAllStreams({ ...sniffParams, id: 30, fresh: true });
  assert.equal(dead.calls, 3, 'a provider whose embeds never sniff is benched');
  assert.equal(live.calls, 4, 'a provider whose embeds sniff fine is not');
});

test('servers that just failed are skipped, unless that leaves none', async () => {
  const reg = new ExtractorRegistry(false);
  const a = fake('a', async () => direct('https://a/x.m3u8'));
  const b = fake('b', async () => direct('https://b/x.m3u8'));
  reg.register(a); reg.register(b);
  const out = await reg.resolveAllStreams({ ...params, fresh: true, exclude: ['a'] });
  assert.equal(a.calls, 0);
  assert.equal(out[0].serverId, 'b');
  const all = await reg.resolveAllStreams({ ...params, fresh: true, exclude: ['a', 'b'] });
  assert.equal(all.length > 0, true, 'excluding every provider falls back to using them all');
});

test('the remembered provider is sniffed alone when it only offers an embed', async () => {
  const reg = new ExtractorRegistry(false);
  const a = fake('a', async () => embed('a'));
  const b = fake('b', async () => embed('b'));
  reg.register(a); reg.register(b);
  const sniffed: string[] = [];
  reg.setSniffer(async e => { sniffed.push(e.serverId!); return e.serverId === 'a' ? direct('https://cdn/a.m3u8') : null; });
  await reg.resolveAllStreams(sniffParams);       // learns that 'a' works
  sniffed.length = 0; a.calls = 0; b.calls = 0;
  const out = await reg.resolveAllStreams(sniffParams);
  assert.equal(out[0].serverId, 'a');
  assert.deepEqual(sniffed, ['a'], 'only the remembered provider is sniffed');
  assert.equal(b.calls, 0, 'the other providers are not even asked');
});
