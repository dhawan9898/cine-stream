import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtractorRegistry } from './registry.ts';
import { electionContext, elect, normalizeLanguages, withExtraLanguages } from './election.ts';
import { printOf } from '../core/printClassifier.ts';
import { nominalHeight, playlistLanguages, tallestRendition } from '../core/streamCheck.ts';
import { languageName, languagesIn } from '../core/language.ts';
import { pickAudio } from '../../services/playbackPrefs.ts';
import type { ExtractedStream } from '../core/types.ts';

const s = (serverId: string, extra: Partial<ExtractedStream> = {}): ExtractedStream =>
  ({ url: `https://${serverId}.test/${extra.height ?? 'x'}.m3u8`, format: 'hls', serverId, ...extra });
const ctx = (language?: string, lastGoodId?: string) => electionContext(language, { lastGoodId, providerOrder: () => [0] });

test('print first: an original 720p beats a theatrical 1080p, on any title', () => {
  const cam = s('a', { height: 1080, releaseName: 'Film (2025) Telugu HDCAM', languages: ['Telugu'] });
  const web = s('b', { height: 720, releaseName: 'Film (2025) Telugu WEB-DL', languages: ['Telugu'] });
  assert.equal(elect([cam, web], ctx('en'))?.serverId, 'b');
  assert.equal(elect([cam, web], ctx('te'))?.serverId, 'b');
});

test('English title: resolution before language', () => {
  const hd = s('a', { height: 1080 });
  const sd = s('b', { height: 720, languages: ['English'] });
  assert.equal(elect([sd, hd], ctx('en'))?.serverId, 'a');
  // Same resolution: the one known to be English.
  assert.equal(elect([s('a', { height: 1080 }), s('b', { height: 1080, languages: ['English'] })], ctx('en'))?.serverId, 'b');
});

test('resolution classes: 2160 > 1440 > 1080 > 720 > 480', () => {
  const list = [480, 2160, 720, 1440, 1080].map(h => s(`p${h}`, { height: h }));
  assert.equal(elect(list, ctx('en'))?.serverId, 'p2160');
  assert.equal(elect(list.filter(x => x.height! < 2160), ctx('en'))?.serverId, 'p1440');
});

test('regional title: language before resolution; unknown beats a known other language', () => {
  const hindi1080 = s('a', { height: 1080, languages: ['Hindi'] });
  const unknown1080 = s('b', { height: 1080 });
  const telugu720 = s('c', { height: 720, languages: ['Telugu'] });
  assert.equal(elect([hindi1080, unknown1080, telugu720], ctx('te'))?.serverId, 'c');
  assert.equal(elect([hindi1080, unknown1080], ctx('te'))?.serverId, 'b');
  // A same-source switch to the title's language counts (the player starts there).
  const lanes = s('d', { height: 1080, languages: ['Hindi'], audios: [
    { label: 'Hindi', language: 'Hindi', url: 'https://d.test/1080.m3u8' },
    { label: 'Telugu', language: 'Telugu', url: 'https://d.test/te.m3u8' }
  ] });
  assert.equal(elect([telugu720, lanes], ctx('te'))?.serverId, 'd');
});

test('stable: input order never changes the winner; ties go to last time\'s provider', () => {
  const a = s('a', { height: 1080 });
  const b = s('b', { height: 1080 });
  assert.equal(elect([a, b], ctx('en'))?.serverId, elect([b, a], ctx('en'))?.serverId);
  assert.equal(elect([a, b], ctx('en', 'b'))?.serverId, 'b');
  assert.equal(elect([b, a], ctx('en', 'a'))?.serverId, 'a');
  // ...but last time's provider never beats a better print or resolution.
  assert.equal(elect([s('a', { height: 720 }), b], ctx('en', 'a'))?.serverId, 'b');
});

test('learned speed does not flip the elected provider', async () => {
  const reg = new ExtractorRegistry(true);
  const all = [s('movy', { height: 1080 }), s('vidrock', { height: 1080 })];
  const first = (await reg.resolveBestStream({ id: 501, type: 'movie' }, all))?.serverId;
  const stats = (reg as unknown as { stats: { record(id: string, ok: boolean, ms?: number): void } }).stats;
  for (let i = 0; i < 20; i++) stats.record(first === 'movy' ? 'vidrock' : 'movy', true, 50);
  for (let i = 0; i < 20; i++) stats.record(first!, true, 9000);
  assert.equal((await reg.resolveBestStream({ id: 501, type: 'movie' }, all))?.serverId, first);
  assert.equal((await reg.resolveBestStream({ id: 502, type: 'movie' }, [...all].reverse()))?.serverId, first);
});

test('one file under several labels becomes one honest entry; playlist languages win', () => {
  const dual = normalizeLanguages(s('hdhub4u', { url: 'https://h.test/a.m3u8', audios: [
    { label: 'Telugu', language: 'Telugu', url: 'https://h.test/a.m3u8' },
    { label: 'Kannada', language: 'Kannada', url: 'https://h.test/a.m3u8' }
  ] }));
  assert.deepEqual(dual.languages, ['Telugu', 'Kannada']);
  assert.deepEqual(dual.audios?.map(a => a.label), ['Telugu + Kannada']);

  // The provider said Telugu; the playlist says the file is Kannada.
  const fixed = normalizeLanguages(s('x', { url: 'https://x.test/a.m3u8', languages: ['kan'], audios: [
    { label: 'Telugu', language: 'Telugu', url: 'https://x.test/a.m3u8' },
    { label: 'Hindi', language: 'Hindi', url: 'https://x.test/hi.m3u8' }
  ] }));
  assert.deepEqual(fixed.audios?.map(a => a.label), ['Kannada', 'Hindi']);
});

test('extras of unknown language are not offered; a multi-audio extra is one entry', () => {
  const main = s('vidlink', { languages: ['English'] });
  const out = withExtraLanguages(main, [s('desicinemas'), s('hdhub4u', { languages: ['Hindi', 'English'] })]);
  assert.deepEqual(out.audios?.map(a => a.label), ['English', 'Hindi + English']);
});

test('playlist audio languages and wide-screen resolution are read from the master playlist', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Hindi",LANGUAGE="hin",URI="hi.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Telugu",LANGUAGE="te",DEFAULT=YES,URI="te.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Track 3",LANGUAGE="und",URI="x.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1920x800,AUDIO="a"',
    'v.m3u8'
  ].join('\n');
  assert.deepEqual(playlistLanguages(master), ['Telugu', 'Hindi']);
  assert.equal(tallestRendition(master), 1080);
  assert.equal(nominalHeight(1280, 536), 720);
  assert.equal(nominalHeight(3840, 1600), 2160);
  assert.deepEqual(playlistLanguages('<MPD><AdaptationSet contentType="audio" lang="ta"></AdaptationSet></MPD>'), ['Tamil']);
});

test('language names: codes, names and release titles; no guess when none is named', () => {
  assert.equal(languageName('te-IN'), 'Telugu');
  assert.equal(languageName('KAN'), 'Kannada');
  assert.equal(languageName('Telugu Dubbed'), 'Telugu');
  assert.equal(languageName('und'), undefined);
  assert.deepEqual(languagesIn('Pushpa 2 (2024) Telugu + Hindi HDRip', 'Pushpa 2'), ['Telugu', 'Hindi']);
  assert.deepEqual(languagesIn('Pushpa 2 (2024) HDRip', 'Pushpa 2'), []);
  assert.deepEqual(languagesIn('English Vinglish (2012) Hindi', 'English Vinglish'), ['Hindi']);
});

test('print: theatrical by release name, server name, quality or a clear URL token', () => {
  assert.equal(printOf({ url: 'https://x/a.m3u8', releaseName: 'Kalki (2024) Telugu PreDVD' }), 'theater');
  assert.equal(printOf({ url: 'https://x/a.m3u8', releaseName: 'Kalki (2024) HQ S-Print' }), 'theater');
  assert.equal(printOf({ url: 'https://x/a.m3u8', quality: 'HDTS' }), 'theater');
  assert.equal(printOf({ url: 'https://cdn/kalki-2024-camrip/index.m3u8' }), 'theater');
  // "ts"/"tc" in an address are segments and hosts, not prints.
  assert.equal(printOf({ url: 'https://ts.cdn.test/hls/ts/seg.ts' }), 'original');
  assert.equal(printOf({ url: 'https://x/a.m3u8', releaseName: 'hdrip telugu dubbed' }), 'original');
  assert.equal(printOf({ url: 'https://x/a.m3u8' }), 'original');
});

test('the player keeps the elected stream unless the viewer chose a language', () => {
  const main = withExtraLanguages(s('movy', { height: 1080 }), [s('movierulz', { url: 'https://mr.test/te.m3u8', languages: ['Telugu'] })]);
  assert.equal(pickAudio(main, 'te', { allowOtherSource: false }).url, main.url);
  assert.equal(pickAudio(main, 'te').url, 'https://mr.test/te.m3u8');
  // A multi-audio file that has the language among its tracks plays as it is.
  const dual = normalizeLanguages(s('h', { languages: ['Hindi', 'Telugu'] }));
  assert.equal(pickAudio(dual, 'te', { allowOtherSource: false }).url, dual.url);
});

test('a theatrical 1080p does not end the race: an original print arriving later wins', async () => {
  const reg = new ExtractorRegistry(false);
  const delay = <T,>(ms: number, v: T) => new Promise<T>(r => setTimeout(() => r(v), ms));
  reg.register({ id: 'cam', name: 'cam', mainUrl: 'https://cam', manifest: { idKind: 'tmdb', costHint: 'api', priorMs: 100 },
    extract: async () => ({ url: 'https://cam.test/1080/a.m3u8', format: 'hls', height: 1080, releaseName: 'Film HDCAM' }) });
  reg.register({ id: 'web', name: 'web', mainUrl: 'https://web', manifest: { idKind: 'tmdb', costHint: 'api', priorMs: 100 },
    extract: () => delay(700, { url: 'https://web.test/720/a.m3u8', format: 'hls' as const, height: 720 }) });
  const all = await reg.resolveAllStreams({ id: 9, type: 'movie', fresh: true, allowSniff: false });
  assert.equal((await reg.resolveBestStream({ id: 9, type: 'movie' }, all))?.serverId, 'web');
});
