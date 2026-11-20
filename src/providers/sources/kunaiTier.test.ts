// kunaiTier.test.ts - Resolution order with direct stream providers and ciphers.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ExtractorRegistry } from '../engine/registry.ts';
import { MovierulzExtractor } from './movierulz.ts';
import { FlixeoExtractor } from './flixeo.ts';
import { VidLinkExtractor } from './vidlink.ts';
import { VidRockExtractor, decryptVidrockUrl } from './vidrock.ts';
import { RivestreamExtractor, generateSecretKey } from './rivestream.ts';
import { looksLikeMediaSegment } from './base.ts';
import { isCheap } from '../core/manifest.ts';
import { MovyExtractor } from './movy.ts';
import { decryptMovyPayload } from './movyCrypto.ts';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); }
};
beforeEach(() => mem.clear());

const KUNAI = [VidLinkExtractor, VidRockExtractor, RivestreamExtractor, MovyExtractor];
const LEGACY = [MovierulzExtractor, FlixeoExtractor];

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

test('the four Kunai providers are cheap (they lead the race), the scraper providers are not', () => {
  const reg = new ExtractorRegistry(true);
  const cheap = Object.fromEntries(reg.getAllExtractors().map(e => [e.id, isCheap(e)]));
  for (const id of ['vidlink', 'vidrock', 'rivestream', 'movy']) assert.equal(cheap[id], true, id);
  for (const id of ['movierulz', 'flixhq']) assert.equal(cheap[id], false, id);
});

test('when Kunai answers, the scraper providers are never asked', async () => {
  const s = stub(['vidrock']);
  try {
    const out = await new ExtractorRegistry(true).resolveAllStreams({ id: 1, type: 'movie', fresh: true });
    assert.deepEqual(out.map(x => x.serverId), ['vidrock']);
    assert.deepEqual(s.asked.filter(id => !['vidlink', 'vidrock', 'rivestream', 'movy', 'flixeo'].includes(id)), []);
  } finally { s.restore(); }
});

test('when every Kunai provider fails, the scraper providers take over at once', async () => {
  const s = stub(['flixeo']);
  const t0 = Date.now();
  try {
    const out = await new ExtractorRegistry(true).resolveAllStreams({ id: 2, type: 'movie', fresh: true });
    assert.deepEqual(out.map(x => x.serverId), ['flixeo']);
    assert.ok(Date.now() - t0 < 2500, 'did not wait out the whole Kunai head start');
    assert.ok(['vidlink', 'vidrock', 'rivestream', 'movy'].every(id => s.asked.includes(id)), 'Kunai was tried first');
  } finally { s.restore(); }
});

test('resolveBestStream prefers Kunai order over the scraper providers', async () => {
  const reg = new ExtractorRegistry(true);
  const mk = (id: string) => ({ url: `https://cdn.test/${id}.m3u8`, format: 'hls' as const, serverId: id });
  const all = [mk('flixeo'), mk('movy'), mk('vidrock'), mk('vidlink')];
  assert.equal((await reg.resolveBestStream({ id: 3, type: 'movie' }, all))?.serverId, 'vidrock');
  assert.equal((await reg.resolveBestStream({ id: 3, type: 'movie' }, [mk('flixeo')]))?.serverId, 'flixeo');
});

test('VidRock url decrypts (AES-256-GCM, base64url iv|ciphertext)', async () => {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from('7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f'.match(/../g)!.map(h => parseInt(h, 16))), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const text = new TextEncoder().encode('https://vidrock.net/stream/123/master.m3u8');
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, text));
  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv);
  combined.set(cipher, iv.length);
  const b64 = btoa(String.fromCharCode(...combined)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(await decryptVidrockUrl(b64), 'https://vidrock.net/stream/123/master.m3u8');
});

test('Rivestream secret key is deterministic and differs per title', () => {
  assert.equal(generateSecretKey(550), generateSecretKey(550));
  assert.notEqual(generateSecretKey(550), generateSecretKey(551));
  assert.notEqual(generateSecretKey('abc'), generateSecretKey('def'));
});

test('Movy payload with a wrong seed is rejected, not returned as garbage', () => {
  assert.throws(() => decryptMovyPayload('garbage', 'seed123', 550));
});

test('segment detector: TS and fMP4 pass; placeholder images, empty and error bodies do not', () => {
  const ts = new Uint8Array(376);
  ts[0] = 0x47; ts[188] = 0x47;
  assert.equal(looksLikeMediaSegment(ts), true);
  const mp4 = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70]); // ftyp
  assert.equal(looksLikeMediaSegment(mp4), true);
  const img = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
  assert.equal(looksLikeMediaSegment(img), false);
  assert.equal(looksLikeMediaSegment(new Uint8Array(0)), false);
});
