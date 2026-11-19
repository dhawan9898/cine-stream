import test from 'node:test';
import assert from 'node:assert/strict';
import { dashMinutes, heightOf, hlsMinutes, isWrongLength, tallestRendition } from './streamCheck.ts';
import { ExtractorRegistry, withExtraLanguages } from './extractorRegistry.ts';
import type { ExtractedStream, StreamExtractor } from './types.ts';

test('playlist length: HLS segments add up, DASH reads its duration', () => {
  assert.equal(hlsMinutes('#EXTM3U\n#EXTINF:30.0,\na.ts\n#EXTINF:30,\nb.ts\n#EXT-X-ENDLIST'), 1);
  assert.equal(hlsMinutes('#EXTM3U\n'), undefined);
  assert.equal(Math.round(dashMinutes('<MPD mediaPresentationDuration="PT2H51M39.5S">')! * 10) / 10, 171.7);
  assert.equal(dashMinutes('<MPD>'), undefined);
});

test('renditions and quality labels give a height', () => {
  assert.equal(tallestRendition('#EXT-X-STREAM-INF:RESOLUTION=1280x720\na\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nb'), 1080);
  assert.equal(tallestRendition('<Representation id="1" height="360"/><Representation height="720" />'), 720);
  assert.equal(heightOf('1080p'), 1080);
  assert.equal(heightOf('4K'), 2160);
  assert.equal(heightOf('HD'), undefined);
});

test('a stream far off the film\'s runtime is another title; small cut differences are not', () => {
  assert.equal(isWrongLength(108.7, 177), true); // the Devara case
  assert.equal(isWrongLength(171.5, 177), false);
  assert.equal(isWrongLength(166.9, 172), false);
  assert.equal(isWrongLength(300, 120), true);
  assert.equal(isWrongLength(undefined, 120), false);
  assert.equal(isWrongLength(100, undefined), false);
});

const stream = (serverId: string, extra: Partial<ExtractedStream> = {}): ExtractedStream => ({ url: `https://${serverId}.test/a.m3u8`, format: 'hls', serverId, ...extra });

test('Movierulz languages are added to the main stream with their own headers, without duplicates', () => {
  const main = stream('vidrock', { audios: [{ label: 'Telugu', language: 'Telugu', url: 'https://vidrock.test/te.m3u8' }, { label: 'Hindi', language: 'Hindi', url: 'https://vidrock.test/hi.m3u8' }] });
  const mr = stream('movierulz', {
    headers: { Referer: 'https://player.test/' },
    audios: ['Telugu', 'Hindi', 'Tamil', 'Malayalam'].map(l => ({ label: l, language: l, url: `https://mr.test/${l}.m3u8` }))
  });
  const out = withExtraLanguages(main, [mr]);
  assert.deepEqual(out.audios!.map(a => a.label), ['Telugu', 'Hindi', 'Tamil', 'Malayalam']);
  assert.equal(out.url, main.url);
  assert.deepEqual(out.audios![2].headers, { Referer: 'https://player.test/' });
  assert.equal(out.audios![0].headers, undefined);
});

test('a main stream of unknown language is "Default" (never guessed); a known one says its language', () => {
  const mr = stream('movierulz', { audios: ['Telugu', 'Hindi'].map(l => ({ label: l, language: l, url: `https://mr.test/${l}.m3u8` })) });
  assert.deepEqual(withExtraLanguages(stream('movy'), [mr]).audios!.map(a => a.label), ['Default', 'Telugu', 'Hindi']);
  assert.deepEqual(withExtraLanguages(stream('movy', { languages: ['English'] }), [mr]).audios!.map(a => a.label), ['English', 'Telugu', 'Hindi']);
  // A language the main stream already has is not added again.
  assert.deepEqual(withExtraLanguages(stream('movy', { languages: ['Telugu'] }), [mr]).audios!.map(a => a.label), ['Telugu', 'Hindi']);
});

test('a sharp stream beats a blurry one that would answer a little sooner', async () => {
  const reg = new ExtractorRegistry(true);
  const best = await reg.resolveBestStream({ id: 77, type: 'movie' }, [stream('rivestream', { height: 480 }), stream('movy', { height: 1080 })]);
  assert.equal(best?.serverId, 'movy');
});

test('the race drops a stream whose length does not fit the film', async () => {
  const reg = new ExtractorRegistry(false);
  const fake = (id: string, url: string): StreamExtractor => ({ id, name: id, mainUrl: `https://${id}`, manifest: { idKind: 'tmdb', costHint: 'api', priorMs: 100 }, extract: async () => ({ url, format: 'hls' }) });
  reg.register(fake('wrong', 'https://wrong.test/a.m3u8'));
  reg.register(fake('right', 'https://right.test/a.m3u8'));
  reg.setRuntimeLookup(async () => 177);
  reg.setStreamInspector(async s => ({ minutes: s.url.includes('wrong') ? 108 : 172 }));
  const out = await reg.resolveAllStreams({ id: 811941, type: 'movie', fresh: true, allowSniff: false });
  assert.deepEqual(out.map(s => s.serverId), ['right']);
});

test('requested language audio track is selected when available', async () => {
  const reg = new ExtractorRegistry(true);
  const dubbed = stream('vidrock', { url: 'https://vidrock.test/720/index.m3u8', audios: [
    { label: 'Telugu', language: 'Telugu', url: 'https://vidrock.test/720/index.m3u8' },
    { label: 'Hindi', language: 'Hindi', url: 'https://vidrock.test/hi/720/index.m3u8' }
  ], headers: { Referer: 'https://vidrock.test/' } });
  const mr = stream('movierulz', { audios: [{ label: 'Tamil', language: 'Tamil', url: 'https://mr.test/ta.m3u8' }] });
  const best = await reg.resolveBestStream({ id: 78, type: 'movie', language: 'te' }, [mr, dubbed, stream('movy', { height: 1080 })]);
  assert.equal(best?.serverId, 'vidrock', 'Telugu matching stream selected');

  const { pickAudio } = await import('../../services/playbackPrefs.ts');
  const main = withExtraLanguages(stream('movy', { height: 1080 }), [stream('movierulz', { audios: [{ label: 'Telugu', language: 'Telugu', url: 'https://mr.test/te.m3u8' }] })]);
  assert.equal(pickAudio(main, 'te').url, 'https://mr.test/te.m3u8');
});

test('a fast Movierulz answer does not end the race before the main providers answer', async () => {
  const reg = new ExtractorRegistry(false);
  const delay = <T,>(ms: number, v: T) => new Promise<T>(r => setTimeout(() => r(v), ms));
  reg.register({ id: 'movierulz', name: 'mr', mainUrl: 'https://mr', manifest: { idKind: 'search', costHint: 'api', priorMs: 100, languagesOnly: true }, extract: async () => ({ url: 'https://mr.test/a.m3u8', format: 'hls' }) });
  reg.register({ id: 'main', name: 'main', mainUrl: 'https://main', manifest: { idKind: 'tmdb', costHint: 'api', priorMs: 100 }, extract: () => delay(600, { url: 'https://main.test/a.m3u8', format: 'hls' as const }) });
  const out = await reg.resolveAllStreams({ id: 5, type: 'movie', fresh: true, allowSniff: false });
  assert.deepEqual(out.map(s => s.serverId).sort(), ['main', 'movierulz']);
});
