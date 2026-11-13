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
import { looksLikeMediaSegment } from './baseExtractor.ts';
import { isCheap } from './manifest.ts';
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

test('the four Kunai providers are cheap (they lead the race), the embed and scraper providers are not', () => {
  const reg = new ExtractorRegistry(true);
  const cheap = Object.fromEntries(reg.getAllExtractors().map(e => [e.id, isCheap(e)]));
  for (const id of ['vidlink', 'vidrock', 'rivestream', 'movy']) assert.equal(cheap[id], true, id);
  for (const id of ['movierulz', 'flixeo', 'vega', 'cinehype', 'flixhq']) assert.equal(cheap[id], false, id);
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
type Bytes = (url: string, headers?: Record<string, string>) => Promise<Uint8Array>;
const TS_BYTES = (() => { const b = new Uint8Array(1880); for (let i = 0; i < b.length; i += 188) b[i] = 0x47; return b; })();
const PNG_70 = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(62).fill(0)]);
function withHttp<T extends object>(ex: T, impl: Http, bytes: Bytes = async () => TS_BYTES): T {
  (ex as unknown as { httpGet: Http }).httpGet = impl;
  (ex as unknown as { httpGetBytes: Bytes }).httpGetBytes = bytes;
  return ex;
}
// A master playlist whose one rendition is v.m3u8, whose one segment is seg0.ts.
const GOOD_M3U8 = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n';
const MEDIA_M3U8 = '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\nseg0.ts\n#EXT-X-ENDLIST\n';

test('Rivestream skips a service whose CDN is dead and returns one that plays', async () => {
  const ex = withHttp(new RivestreamExtractor(), async url => {
    if (url.includes('VideoProviderServices')) return JSON.stringify({ data: ['dead', 'alive'] });
    if (url.includes('service=dead')) return JSON.stringify({ data: [{ url: 'https://cdn.test/dead.m3u8', quality: '1080', format: 'hls' }] });
    if (url.includes('service=alive')) return JSON.stringify({ data: [{ url: 'https://cdn.test/alive.m3u8', quality: '720', format: 'hls' }] });
    if (url.includes('dead.m3u8')) throw new Error('HTTP 502');
    if (url.includes('alive.m3u8')) return GOOD_M3U8;
    if (url.endsWith('v.m3u8')) return MEDIA_M3U8;
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

test('Kunai links are marked for early re-checking when saved; legacy links keep the default', async () => {
  const s = stub(['vidrock']);
  try {
    const out = await new ExtractorRegistry(true).resolveAllStreams({ id: 7, type: 'movie', fresh: true });
    assert.equal(out[0].revalidateAfterMs, 2 * 60 * 1000);
  } finally { s.restore(); }
  const s2 = stub(['flixeo']);
  try {
    const out = await new ExtractorRegistry(true).resolveAllStreams({ id: 8, type: 'movie', fresh: true });
    assert.equal(out[0].revalidateAfterMs, undefined);
  } finally { s2.restore(); }
});

test('a lane whose playlist is fine but whose segments are placeholder images is skipped', async () => {
  const ex = withHttp(new RivestreamExtractor(), async url => {
    if (url.includes('VideoProviderServices')) return JSON.stringify({ data: ['dead', 'alive'] }); // (the service list is cached by the earlier test)
    if (url.includes('service=dead')) return JSON.stringify({ data: [{ url: 'https://fake.test/m.m3u8', format: 'hls' }] });
    if (url.includes('service=alive')) return JSON.stringify({ data: [{ url: 'https://real.test/m.m3u8', format: 'hls' }] });
    if (url.endsWith('/m.m3u8')) return GOOD_M3U8;
    if (url.endsWith('v.m3u8')) return MEDIA_M3U8;
    throw new Error('unexpected ' + url);
  }, async url => (url.startsWith('https://fake.test') ? PNG_70 : TS_BYTES));
  const s = await ex.extract({ id: 600, type: 'tv', season: 1, episode: 1 });
  assert.equal(s?.url, 'https://real.test/m.m3u8');
});

test('segment detector: TS and fMP4 pass; placeholder images, empty and error bodies do not', () => {
  assert.equal(looksLikeMediaSegment(TS_BYTES), true);
  const junkThenTs = new Uint8Array(1200); junkThenTs.fill(0xaa); for (let i = 40; i + 188 <= junkThenTs.length; i += 188) junkThenTs[i] = 0x47;
  assert.equal(looksLikeMediaSegment(junkThenTs), true);
  const mp4 = new Uint8Array(32); mp4.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]); // "ftyp"
  assert.equal(looksLikeMediaSegment(mp4), true);
  assert.equal(looksLikeMediaSegment(PNG_70), false);
  assert.equal(looksLikeMediaSegment(new Uint8Array(0)), false);
  assert.equal(looksLikeMediaSegment(new TextEncoder().encode('<html>blocked</html>')), false);
  assert.equal(looksLikeMediaSegment(Uint8Array.from([0x2e])), false);
});
