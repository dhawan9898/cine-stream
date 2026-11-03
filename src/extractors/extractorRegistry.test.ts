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
