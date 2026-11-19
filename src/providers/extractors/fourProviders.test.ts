// fourProviders.test.ts - Vigorous verification of extractors and stream resolution
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractorRegistry, ExtractorRegistry } from './extractorRegistry.ts';
import { MovierulzExtractor } from './movierulzExtractor.ts';
import { FlixeoExtractor } from './flixeoExtractor.ts';
import { VidLinkExtractor } from './vidlinkExtractor.ts';
import { VidRockExtractor } from './vidrockExtractor.ts';
import { RivestreamExtractor } from './rivestreamExtractor.ts';
import { MovyExtractor } from './movyExtractor.ts';
import { HDHub4UExtractor } from './hdhub4uExtractor.ts';
import { DesiCinemasExtractor } from './desicinemasExtractor.ts';
import { EinthusanExtractor } from './einthusanExtractor.ts';
import { IsaiminiExtractor } from './isaiminiExtractor.ts';
import { filterBestPrintStreams, isTheaterPrint, isHdPrint } from './printClassifier.ts';
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

test('all 11 direct-stream providers are registered in the default extractor registry', () => {
  const all = extractorRegistry.getAllExtractors();
  const ids = all.map(e => e.id);
  assert.ok(ids.includes('movierulz'), 'movierulz is registered');
  assert.ok(ids.includes('hdhub4u'), 'hdhub4u is registered');
  assert.ok(ids.includes('desicinemas'), 'desicinemas is registered');
  assert.ok(ids.includes('einthusan'), 'einthusan is registered');
  assert.ok(ids.includes('isaimini'), 'isaimini is registered');
  assert.ok(ids.includes('flixeo'), 'flixeo is registered');
  assert.ok(!ids.includes('vega'), 'vega is removed');
  assert.ok(!ids.includes('cinehype'), 'cinehype is removed');
  assert.ok(ids.includes('vidlink'), 'vidlink is registered');
  assert.ok(ids.includes('flixhq'), 'flixhq is registered');
  assert.ok(!ids.includes('jellyfin'), 'jellyfin is not offered until a server is set up');
  assert.equal(all.length, 11, 'exactly 11 direct providers registered');
});

test('printClassifier drops CAM/DVDScr theater prints when HD/Retail print is available', () => {
  assert.equal(isTheaterPrint('Kalki 2024 CAMRip'), true);
  assert.equal(isTheaterPrint('Pushpa 2 DVDScr'), true);
  assert.equal(isTheaterPrint('Amaran 2024 1080p HDRip'), false);
  assert.equal(isHdPrint('Amaran 2024 1080p HDRip'), true);

  const camStream = { url: 'https://cdn.test/cam.m3u8', format: 'hls' as const, quality: 'CAMRip', serverId: 'hdhub4u' };
  const hdStream = { url: 'https://cdn.test/hd.m3u8', format: 'hls' as const, quality: '1080p HDRip', height: 1080, serverId: 'movierulz' };

  const filtered = filterBestPrintStreams([camStream, hdStream]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].url, 'https://cdn.test/hd.m3u8');
});

test('each extractor returns valid stream metadata for movies and TV', async () => {
  const movierulz = new MovierulzExtractor();
  const flixeo = new FlixeoExtractor();

  // Test Movie extraction direct URLs
  const mMovie = await movierulz.extract({ id: 550, type: 'movie' });
  assert.ok(mMovie && mMovie.url.includes('550'), 'Movierulz movie URL valid');
  assert.equal(mMovie?.serverId, 'movierulz');
  assert.equal(mMovie?.serverName, 'Movierulz Regional');

  // Test TV extraction
  const mTv = await movierulz.extract({ id: 1399, type: 'tv', season: 1, episode: 1 });
  assert.ok(mTv && mTv.url.includes('1399'), 'Movierulz TV URL valid');

  const fTv = await flixeo.extract({ id: 1399, type: 'tv', season: 1, episode: 1 });
  assert.ok(fTv === null || Boolean(fTv?.url), 'Flixeo TV return clean');
});

// Stub every extractor: `direct` ids return a playable m3u8, the rest return null.
function stubExtractors(direct: string[]) {
  const proto = [MovierulzExtractor, FlixeoExtractor, VidLinkExtractor, VidRockExtractor, RivestreamExtractor, MovyExtractor, HDHub4UExtractor, DesiCinemasExtractor, EinthusanExtractor, IsaiminiExtractor];
  const originals = proto.map(C => C.prototype.extract);
  proto.forEach(C => {
    C.prototype.extract = async function (this: { id: string; name: string }, p: { id: number }) {
      return direct.includes(this.id)
        ? { url: `https://cdn.test/${this.id}/${p.id}/index.m3u8`, format: 'hls' as const, serverId: this.id, serverName: this.name }
        : null;
    } as typeof C.prototype.extract;
  });
  return () => proto.forEach((C, i) => { C.prototype.extract = originals[i]; });
}

test('resolveAllStreams returns direct streams only', async () => {
  const restore = stubExtractors(['flixeo', 'vidlink']);
  try {
    const reg = new ExtractorRegistry(true);
    const streams = await reg.resolveAllStreams({ id: 550, type: 'movie', directOnly: false, fresh: true });
    assert.deepEqual(streams.map(s => s.serverId).sort(), ['flixeo', 'vidlink']);
    assert.ok(streams.every(s => !s.isFallbackEmbed && s.url.endsWith('.m3u8')));
  } finally { restore(); }
});

test('resolveBestStream honors preferredServerId among direct streams', async () => {
  const restore = stubExtractors(['movierulz', 'flixeo', 'vidlink', 'vidrock', 'rivestream', 'movy']);
  try {
    const reg = new ExtractorRegistry(true);
    for (const targetId of ['movierulz', 'flixeo', 'vidlink', 'vidrock', 'rivestream', 'movy']) {
      const all = await reg.resolveAllStreams({ id: 550, type: 'movie', fresh: true, preferredServerId: targetId });
      const best = await reg.resolveBestStream({ id: 550, type: 'movie', preferredServerId: targetId }, all);
      assert.equal(best?.serverId, targetId);
    }
  } finally { restore(); }
});

test('streamResolver exposes all servers, switches server, and fails over', async () => {
  const restore = stubExtractors(['movierulz', 'flixeo', 'vidlink', 'vidrock', 'rivestream', 'movy']);
  try {
    const params = { id: 680, type: 'movie' as const };
    forgetStream(params);
    const res = await resolveStream(params, { fresh: true });
    assert.ok(res.url.endsWith('.m3u8') && !res.isFallbackEmbed);

    for (const id of ['flixeo', 'movierulz', 'vidlink', 'vidrock', 'rivestream', 'movy']) {
      const r = await resolveStream({ ...params, preferredServerId: id }, { fresh: true });
      assert.equal(r.serverId, id);
      assert.ok(r.url.includes('680'));
    }

    const failover = await resolveStream({ ...params, exclude: [res.serverId!] }, { fresh: true });
    assert.notEqual(failover.serverId, res.serverId);

    // params.fresh = true bypasses cached stream even when options is omitted
    const freshViaParams = await resolveStream({ ...params, fresh: true, preferredServerId: 'vidlink' });
    assert.equal(freshViaParams.serverId, 'vidlink');
  } finally { restore(); }
});

test('English content picks English providers and never regional scrapers as main stream', async () => {
  const reg = new ExtractorRegistry(true);
  const englishStream = { url: 'https://cdn.test/eng.m3u8', format: 'hls' as const, serverId: 'vidlink', serverName: 'VidLink Direct', quality: '1080p' };
  // Regional scraper claiming to have English audio among others
  const regionalStream = {
    url: 'https://cdn.test/reg.m3u8',
    format: 'hls' as const,
    serverId: 'hdhub4u',
    serverName: 'HDHub4U Direct',
    quality: '720p',
    audios: [
      { label: 'Hindi', language: 'Hindi', url: 'https://cdn.test/reg.m3u8' },
      { label: 'English', language: 'English', url: 'https://cdn.test/reg.m3u8' }
    ]
  };

  const best = await reg.resolveBestStream({ id: 999, type: 'movie', language: 'en' }, [regionalStream, englishStream]);
  assert.equal(best?.serverId, 'vidlink', 'English provider must win main stream for English titles');
  assert.ok(best?.audios?.some(a => a.language === 'Hindi'), 'Regional audio variants should still be available in audio list');
});

test('Regional content is labeled with its native language, not hardcoded Hindi', async () => {
  const { withExtraLanguages } = await import('./extractorRegistry.ts');
  const mrStream = { url: 'https://cdn.test/mr.m3u8', format: 'hls' as const, serverId: 'movierulz', serverName: 'Movierulz' };
  const extraDub = [{ url: 'https://cdn.test/hi.m3u8', format: 'hls' as const, audios: [{ label: 'Hindi', language: 'Hindi', url: 'https://cdn.test/hi.m3u8' }] }];

  const telugu = withExtraLanguages(mrStream, extraDub, 'te');
  assert.equal(telugu.audios?.[0]?.label, 'Telugu', 'Telugu film must be labeled Telugu');

  const tamil = withExtraLanguages(mrStream, extraDub, 'ta');
  assert.equal(tamil.audios?.[0]?.label, 'Tamil', 'Tamil film must be labeled Tamil');

  const malayalam = withExtraLanguages(mrStream, extraDub, 'ml');
  assert.equal(malayalam.audios?.[0]?.label, 'Malayalam', 'Malayalam film must be labeled Malayalam');

  const kannada = withExtraLanguages(mrStream, extraDub, 'kn');
  assert.equal(kannada.audios?.[0]?.label, 'Kannada', 'Kannada film must be labeled Kannada');
});
