// kunaiTier.test.ts - Kunai-first resolution with fallback to the embed-based providers, and the ported ciphers.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ExtractorRegistry } from './extractorRegistry.ts';
import { MovierulzExtractor } from './movierulzExtractor.ts';
import { FlixeoExtractor } from './flixeoExtractor.ts';
import { VegaExtractor } from './vegaExtractor.ts';
import { CineHypeExtractor } from './cinehypeExtractor.ts';
import { VidLinkExtractor } from './vidlinkExtractor.ts';
import { VidRockExtractor, decryptVidrockUrl } from './vidrockExtractor.ts';
import { RivestreamExtractor, generateSecretKey } from './rivestreamExtractor.ts';
import { MovyExtractor } from './movyExtractor.ts';
import { decryptMovyPayload } from './movyCrypto.ts';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); }
};
beforeEach(() => mem.clear());

const KUNAI = [VidLinkExtractor, VidRockExtractor, RivestreamExtractor, MovyExtractor];
const LEGACY = [MovierulzExtractor, FlixeoExtractor, VegaExtractor, CineHypeExtractor];

/** `works` ids answer with a direct stream, every other provider answers nothing; returns who was asked. */
function stub(works: string[]) {
  const asked: string[] = [];
  const all = [...KUNAI, ...LEGACY] as { prototype: { extract: unknown; id: string; name: string } }[];
  const originals = all.map(C => C.prototype.extract);
  all.forEach(C => {
    C.prototype.extract = async function (this: { id: string; name: string }, p: { id: number }) {
      asked.push(this.id);
      return works.includes(this.id)
        ? { url: `https://cdn.test/${this.id}/${p.id}/index.m3u8`, format: 'hls' as const, serverId: this.id, serverName: this.name }
        : null;
    };
  });
  return { asked, restore: () => all.forEach((C, i) => { C.prototype.extract = originals[i]; }) };
}

test('the four Kunai providers are flagged as the primary tier, the legacy four are not', () => {
  const reg = new ExtractorRegistry(true);
  const tiers = Object.fromEntries(reg.getAllExtractors().map(e => [e.id, e.tier]));
  for (const id of ['vidlink', 'vidrock', 'rivestream', 'movy']) assert.equal(tiers[id], 'primary', id);
  for (const id of ['movierulz', 'flixeo', 'vega', 'cinehype']) assert.equal(tiers[id], undefined, id);
});

test('when Kunai answers, the legacy providers are never asked', async () => {
  const s = stub(['vidrock']);
  try {
    const out = await new ExtractorRegistry(true).resolveAllStreams({ id: 1, type: 'movie', fresh: true });
    assert.deepEqual(out.map(x => x.serverId), ['vidrock']);
    assert.deepEqual(s.asked.filter(id => !['vidlink', 'vidrock', 'rivestream', 'movy'].includes(id)), []);
  } finally { s.restore(); }
});

test('when every Kunai provider fails, the legacy providers take over at once', async () => {
  const s = stub(['flixeo']);
  const t0 = Date.now();
  try {
    const out = await new ExtractorRegistry(true).resolveAllStreams({ id: 2, type: 'movie', fresh: true });
    assert.deepEqual(out.map(x => x.serverId), ['flixeo']);
    assert.ok(Date.now() - t0 < 2500, 'did not wait out the whole Kunai head start');
    assert.ok(['vidlink', 'vidrock', 'rivestream', 'movy'].every(id => s.asked.includes(id)), 'Kunai was tried first');
  } finally { s.restore(); }
});

test('resolveBestStream prefers Kunai order over the legacy providers', async () => {
  const reg = new ExtractorRegistry(true);
  const mk = (id: string) => ({ url: `https://cdn.test/${id}.m3u8`, format: 'hls' as const, serverId: id });
  const all = [mk('vega'), mk('movy'), mk('vidrock'), mk('flixeo')];
  assert.equal((await reg.resolveBestStream({ id: 3, type: 'movie' }, all))?.serverId, 'vidrock');
  assert.equal((await reg.resolveBestStream({ id: 3, type: 'movie' }, [mk('vega'), mk('flixeo')]))?.serverId, 'vega');
});

test('VidRock url decrypts (AES-256-GCM, base64url iv|ciphertext)', async () => {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from('7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f'.match(/../g)!.map(h => parseInt(h, 16))), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('https://cdn.example/x.m3u8')));
  const joined = new Uint8Array([...iv, ...ct]);
  const b64url = btoa(String.fromCharCode(...joined)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(await decryptVidrockUrl(b64url), 'https://cdn.example/x.m3u8');
  await assert.rejects(decryptVidrockUrl('AAAA'));
});

test('Rivestream secret key is deterministic and differs per title', () => {
  assert.equal(generateSecretKey(550), generateSecretKey(550));
  assert.notEqual(generateSecretKey(550), generateSecretKey(551));
  assert.match(generateSecretKey(550), /^[A-Za-z0-9+/=]+$/);
});

test('Movy payload with a wrong seed is rejected, not returned as garbage', () => {
  assert.throws(() => decryptMovyPayload('AAAAAAAAAAAAAAAA', 'seed', 550), /decrypt failed/);
});

// ---- probing and rate limits (HTTP stubbed on the extractor, no network) ----
type Http = (url: string, headers?: Record<string, string>) => Promise<string>;
function withHttp<T extends object>(ex: T, impl: Http): T {
  (ex as unknown as { httpGet: Http }).httpGet = impl;
  return ex;
}
const GOOD_M3U8 = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n';

test('Rivestream skips a service whose CDN is dead and returns one that plays', async () => {
  const ex = withHttp(new RivestreamExtractor(), async url => {
    if (url.includes('VideoProviderServices')) return JSON.stringify({ data: ['dead', 'alive'] });
    if (url.includes('service=dead')) return JSON.stringify({ data: [{ url: 'https://cdn.test/dead.m3u8', quality: '1080', format: 'hls' }] });
    if (url.includes('service=alive')) return JSON.stringify({ data: [{ url: 'https://cdn.test/alive.m3u8', quality: '720', format: 'hls' }] });
    if (url.includes('dead.m3u8')) throw new Error('HTTP 502');
    if (url.includes('alive.m3u8')) return GOOD_M3U8;
    throw new Error('unexpected ' + url);
  });
  const s = await ex.extract({ id: 550, type: 'movie' });
  assert.equal(s?.url, 'https://cdn.test/alive.m3u8');
  assert.equal(s?.serverName, 'Rivestream alive');
});

test('a stream whose playlist is not a playlist is rejected, not played', async () => {
  const ex = withHttp(new RivestreamExtractor(), async url => {
    if (url.includes('VideoProviderServices')) return JSON.stringify({ data: ['only'] });
    if (url.includes('service=only')) return JSON.stringify({ data: [{ url: 'https://cdn.test/x.m3u8', format: 'hls' }] });
    return '<html>blocked</html>';
  });
  assert.equal(await ex.extract({ id: 551, type: 'movie' }), null);
});

test('Movy backs off after a 429 instead of hammering the API for every title', async () => {
  let calls = 0;
  const ex = withHttp(new MovyExtractor(), async () => { calls++; throw new Error('HTTP 429'); });
  assert.equal(await ex.extract({ id: 1, type: 'movie', title: 'A' }), null);
  const first = calls;
  assert.ok(first > 0);
  assert.equal(await ex.extract({ id: 2, type: 'movie', title: 'B' }), null);
  assert.equal(calls, first, 'no request was made while cooling down');
});

test('many requests on one abort signal leave no listeners behind', async () => {
  const ac = new AbortController();
  const ex = new VidRockExtractor() as unknown as { httpGet(u: string, h: object, o: object): Promise<string> };
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response('ok')) as typeof fetch;
  let warned = false;
  const onWarn = (w: Error) => { if (w.name === 'MaxListenersExceededWarning') warned = true; };
  process.on('warning', onWarn);
  try {
    await Promise.all(Array.from({ length: 30 }, () => ex.httpGet('https://x.test/', {}, { signal: ac.signal })));
    await new Promise(r => setTimeout(r, 20));
    assert.equal(warned, false);
  } finally { globalThis.fetch = orig; process.off('warning', onWarn); }
});
