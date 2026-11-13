// sources.test.ts - Provider architecture v2: rate limits, id mapping, FlixHQ (lobster / flix-cli),
// the decrypt-API resolver, Jellyfin, alternates and the manifest-driven planner. No network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); }
};

const { HostRateLimiter, RateLimitedError, retryAfterMs } = await import('../extractors/hostLimiter.ts');
const { IdMapper, matchConfidence, normalizeTitle, titleSimilarity } = await import('./idMapper.ts');
const { TtlStore } = await import('./ttlStore.ts');
const flix = await import('./flixhq.ts');
const { parseDecryptAnswer, resetDecryptEndpoints, decryptApiEnabled } = await import('./decryptApi.ts');
const { JellyfinSource, streamsFor } = await import('./jellyfin.ts');
const { saveUserPreferences } = await import('../../services/historyService.ts');
const { setProviderConfig, DEFAULT_PROVIDER_CONFIG } = await import('../providerConfig.ts');
const { ExtractorRegistry } = await import('../extractors/extractorRegistry.ts');
const { pickAlternates } = await import('../streamResolver.ts');
import type { ExtractedStream, StreamExtractor } from '../extractors/types.ts';

beforeEach(() => {
  saveUserPreferences({ flixhqDecryptApi: false, jellyfinUrl: '', jellyfinApiKey: '' });
  setProviderConfig(DEFAULT_PROVIDER_CONFIG);
  resetDecryptEndpoints();
});

// ---------------------------------------------------------------- host rate limiter

test('limiter: a 429 closes the host for everyone; other hosts are unaffected', async () => {
  const lim = new HostRateLimiter();
  await lim.acquire('https://api.a.test/x');
  lim.penalize('https://api.a.test/y', 30_000);
  await assert.rejects(lim.acquire('https://api.a.test/z'), (e: unknown) => e instanceof RateLimitedError && e.reason === 'closed');
  await lim.acquire('https://api.b.test/x');
});

test('limiter: background requests stop at half the budget, foreground ones wait for a token', async () => {
  // A frozen clock: no refill between the calls.
  const lim = new HostRateLimiter(() => 1_000);
  lim.configure('h.test', { rps: 20, burst: 4 });
  await lim.acquire('https://h.test/1', { background: true });
  await lim.acquire('https://h.test/2', { background: true });
  await assert.rejects(lim.acquire('https://h.test/3', { background: true }), (e: unknown) => e instanceof RateLimitedError && e.reason === 'busy');
  await lim.acquire('https://h.test/4');
  await lim.acquire('https://h.test/5');
  await assert.rejects(lim.acquire('https://h.test/6'), (e: unknown) => e instanceof RateLimitedError, 'empty, and no time passes: gives up instead of waiting forever');
  // A real clock: an empty bucket waits briefly for its next token.
  const live = new HostRateLimiter();
  live.configure('w.test', { rps: 20, burst: 1 });
  await live.acquire('https://w.test/1');
  const t0 = Date.now();
  await live.acquire('https://w.test/2'); // empty: waits ~50 ms for a token
  assert.ok(Date.now() - t0 >= 30);
});

test('Retry-After is read as seconds or as a date', () => {
  assert.equal(retryAfterMs('120'), 120_000);
  assert.equal(retryAfterMs(new Date(Date.now() + 10_000).toUTCString(), Date.now())! > 8_000, true);
  assert.equal(retryAfterMs(undefined), undefined);
});

// ---------------------------------------------------------------- id mapping

test('titles are compared without case, accents, punctuation or a leading article', () => {
  assert.equal(normalizeTitle('The Lord of the Rings: The Return of the King'), 'lord of the rings the return of the king');
  assert.equal(titleSimilarity('Amélie', 'Amelie'), 1);
  assert.equal(titleSimilarity('Fast & Furious', 'Fast and Furious'), 1);
  assert.ok(titleSimilarity('Dune', 'Dune: Part Two') < 0.8);
});

test('a remake (year far off) or the wrong kind is never accepted', () => {
  const ref = { tmdbId: 1, type: 'movie' as const, title: 'Dune', year: 2021 };
  assert.ok(matchConfidence({ siteId: 'a', title: 'Dune', type: 'movie', year: 2021 }, ref) >= 0.99);
  assert.ok(matchConfidence({ siteId: 'b', title: 'Dune', type: 'movie', year: 1984 }, ref) <= 0.5);
  assert.equal(matchConfidence({ siteId: 'c', title: 'Dune', type: 'tv', year: 2021 }, ref), 0);
});

test('id mapper: searches once, then serves the cached match; a failed search is not remembered', async () => {
  const mapper = new IdMapper('t_map_1', new TtlStore('t_map_1'));
  const ref = { tmdbId: 10, type: 'movie' as const, title: 'Heat', year: 1995 };
  let searches = 0;
  const failing = async () => { searches++; throw new Error('offline'); };
  assert.equal(await mapper.map('s', ref, failing), null);
  assert.equal(mapper.cached('s', ref), undefined, 'a network failure caches nothing');
  const search = async () => { searches++; return [{ siteId: '7', title: 'Heat', type: 'movie' as const, year: 1995 }]; };
  const [a, b] = await Promise.all([mapper.map('s', ref, search), mapper.map('s', ref, search)]);
  assert.equal(a?.siteId, '7');
  assert.equal(b?.siteId, '7');
  assert.equal(searches, 2, 'two concurrent lookups share one search');
  assert.equal((await mapper.map('s', ref, search))?.siteId, '7');
  assert.equal(searches, 2, 'cached');
});

test('id mapper: no confident match is remembered as absent; the original title is tried too', async () => {
  const mapper = new IdMapper('t_map_2', new TtlStore('t_map_2'));
  const queries: string[] = [];
  const ref = { tmdbId: 11, type: 'movie' as const, title: 'Spirited Away', originalTitle: 'Sen to Chihiro no Kamikakushi', year: 2001 };
  const found = await mapper.map('s', ref, async q => {
    queries.push(q);
    return q.startsWith('Sen') ? [{ siteId: '9', title: 'Sen to Chihiro no Kamikakushi', type: 'movie' as const, year: 2001 }] : [];
  });
  assert.equal(found?.siteId, '9');
  assert.deepEqual(queries, ['Spirited Away', 'Sen to Chihiro no Kamikakushi']);
  const none = { tmdbId: 12, type: 'movie' as const, title: 'Nothing Here' };
  assert.equal(await mapper.map('s', none, async () => [{ siteId: 'x', title: 'Something Else', type: 'movie' as const }]), null);
  assert.equal(mapper.cached('s', none), null, 'remembered as absent');
});

// ---------------------------------------------------------------- FlixHQ parsing (recorded markup)

const SEARCH_HTML = `
<div class="film_list-wrap">
<div class="flw-item">
  <div class="film-poster"><img data-src="https://img.test/p1.jpg" class="film-poster-img lazyload" title="Breaking Bad" alt="Breaking Bad">
  <a href="/tv/watch-breaking-bad-39506" class="film-poster-ahref flw-item-tip" title="Breaking Bad"><i class="fa fa-play"></i></a></div>
  <div class="film-detail"><h2 class="film-name"><a href="/tv/watch-breaking-bad-39506" title="Breaking Bad">Breaking Bad</a></h2>
  <div class="fd-infor"><span class="fdi-item">SS 5</span><span class="dot"></span><span class="fdi-item">EPS 9</span><span class="float-right fdi-type">TV</span></div></div>
</div>
<div class="flw-item">
  <div class="film-poster"><img data-src="https://img.test/p2.jpg" title="El Camino: A Breaking Bad Movie">
  <a href="/movie/watch-el-camino-a-breaking-bad-movie-39507" class="film-poster-ahref" title="El Camino: A Breaking Bad Movie"></a></div>
  <div class="film-detail"><div class="fd-infor"><span class="fdi-item">2019</span><span class="dot"></span><span class="fdi-item fdi-duration">122m</span></div></div>
</div>
<div class="flw-item"><a href="/movie/watch-tom-amp-jerry-1" title="Tom &amp; Jerry"></a><span class="fdi-item">2021</span></div>
</div>`;

test('FlixHQ search cards: id, kind, title (entities decoded), year when shown', () => {
  const r = flix.parseSearch(SEARCH_HTML);
  assert.deepEqual(r.map(x => [x.siteId, x.type, x.title, x.year]), [
    ['39506', 'tv', 'Breaking Bad', undefined],
    ['39507', 'movie', 'El Camino: A Breaking Bad Movie', 2019],
    ['1', 'movie', 'Tom & Jerry', 2021]
  ]);
  assert.equal(r[0].extra?.path, 'tv/watch-breaking-bad-39506');
  assert.equal(flix.searchSlug('Tom & Jerry: The Movie!'), 'tom-jerry-the-movie');
});

const SEASONS_HTML = `<div class="dropdown-menu"><a data-id="16078" class="dropdown-item ss-item" href="javascript:;">Season 1</a>
<a data-id="16079" class="dropdown-item ss-item" href="javascript:;">Season 2</a><a class="x" href="/tv/x-16080">Season 3</a></div>`;
const EPISODES_HTML = `<ul class="nav"><li class="nav-item"><a id="episode-111" data-id="111" class="nav-link eps-item" href="javascript:;" title="Eps 1: Pilot"><strong>Eps 1:</strong> Pilot</a></li>
<li class="nav-item"><a title="Eps 2: Cat's in the Bag..." class="nav-link eps-item" data-id="112" href="javascript:;">x</a></li></ul>`;
const TV_SERVERS_HTML = `<ul class="nav"><li class="nav-item"><a data-id="900" id="watch-900" class="nav-link link-item" title="Server UpCloud"><span>UpCloud</span></a></li>
<li class="nav-item"><a data-id="901" id="watch-901" class="nav-link link-item" title="Server Vidcloud"><span>Vidcloud</span></a></li>
<li class="nav-item"><a data-id="902" class="nav-link link-item" title="Server Voe"><span>Voe</span></a></li></ul>`;
const MOVIE_SERVERS_HTML = `<ul class="nav"><li class="nav-item"><a data-linkid="4829525" class="nav-link link-item" href="/watch-movie/watch-el-camino-39507.4829525" title="UpCloud"><span>UpCloud</span></a></li>
<li class="nav-item"><a class="nav-link link-item" href="/watch-movie/watch-el-camino-39507.4829526" title="Vidcloud"><span>Vidcloud</span></a></li></ul>`;

test('FlixHQ seasons, episodes and servers parse whatever the attribute order', () => {
  assert.deepEqual(flix.parseSeasons(SEASONS_HTML), { 1: '16078', 2: '16079', 3: '16080' });
  assert.deepEqual(flix.parseEpisodes(EPISODES_HTML), { 1: '111', 2: '112' });
  assert.deepEqual(flix.parseTvServers(TV_SERVERS_HTML).map(s => [s.id, s.name]), [['900', 'UpCloud'], ['901', 'Vidcloud'], ['902', 'Voe']]);
  assert.deepEqual(flix.parseMovieServers(MOVIE_SERVERS_HTML).map(s => [s.id, s.name]), [['4829525', 'UpCloud'], ['4829526', 'Vidcloud']]);
  assert.deepEqual(flix.orderServers(flix.parseTvServers(TV_SERVERS_HTML)).map(s => s.name), ['Vidcloud', 'UpCloud', 'Voe']);
});

type Get = (url: string) => Promise<string>;
type Post = (url: string, body: unknown) => Promise<string>;
function flixWith(get: Get, post: Post = async () => { throw new Error('no post'); }) {
  const src = new flix.FlixHQSource();
  const requests: string[] = [];
  (src as unknown as { httpGet: Get }).httpGet = async (u: string) => { requests.push(u); return get(u); };
  (src as unknown as { httpPostJson: Post }).httpPostJson = async (u: string, b: unknown) => { requests.push(`POST ${u}`); return post(u, b); };
  return { src, requests };
}
const flixSite: Get = async u => {
  if (u.includes('/search/breaking-bad')) return SEARCH_HTML;
  if (u.endsWith('/ajax/v2/tv/seasons/39506')) return SEASONS_HTML;
  if (u.endsWith('/ajax/v2/season/episodes/16078')) return EPISODES_HTML;
  if (/\/ajax\/v2\/episode\/servers\/11[12]$/.test(u)) return TV_SERVERS_HTML;
  const src = u.match(/\/ajax\/episode\/sources\/(\d+)$/);
  if (src) return JSON.stringify({ type: 'iframe', link: `https://megacloud.test/embed-2/e-1/${src[1]}?z=` });
  if (u.endsWith('.m3u8')) return '#EXTM3U\n';
  throw new Error('unexpected ' + u);
};

test('FlixHQ, decrypt service off: the embeds go back to the registry to be sniffed, best server first', async () => {
  const { src } = flixWith(flixSite);
  const out = await src.extractAll({ id: 1396, type: 'tv', season: 1, episode: 1, title: 'Breaking Bad' });
  assert.ok(out.length >= 2 && out.every(s => s.isFallbackEmbed && s.serverId === 'flixhq'));
  assert.equal(out[0].serverName, 'FlixHQ Vidcloud');
  assert.equal(out[0].url, 'https://megacloud.test/embed-2/e-1/901?z=');
  assert.equal(decryptApiEnabled(), false);
});

test('FlixHQ, decrypt service on: direct streams with captions; a later episode skips search and seasons', async () => {
  saveUserPreferences({ flixhqDecryptApi: true });
  const posted: unknown[] = [];
  const { src, requests } = flixWith(flixSite, async (_u, body) => {
    posted.push(body);
    return JSON.stringify({ sources: [{ file: 'https://cdn.test/hls/playlist.m3u8', type: 'hls' }], tracks: [{ file: 'https://cdn.test/en.vtt', label: 'English', kind: 'captions' }, { file: 'https://cdn.test/thumbs.vtt', kind: 'thumbnails' }] });
  });
  const out = await src.extractAll({ id: 1397, type: 'tv', season: 1, episode: 1, title: 'Breaking Bad' });
  const direct = out.filter(s => !s.isFallbackEmbed);
  assert.ok(direct.length >= 1);
  assert.equal(direct[0].url, 'https://cdn.test/hls/playlist.m3u8');
  assert.equal(direct[0].headers?.Referer, 'https://megacloud.test/');
  assert.deepEqual(direct[0].subtitles?.map(s => s.label), ['English']);
  assert.deepEqual((posted[0] as { mediaId: string }).mediaId, 'tv/watch-breaking-bad-39506');

  requests.length = 0;
  await src.extractAll({ id: 1397, type: 'tv', season: 1, episode: 2, title: 'Breaking Bad' });
  assert.ok(!requests.some(r => r.includes('/search/') || r.includes('/seasons/') || r.includes('/season/episodes/')), requests.join('\n'));
  assert.ok(requests.some(r => r.endsWith('/ajax/v2/episode/servers/112')));
});

test('FlixHQ: a title that is not on the site gives nothing (and is not searched again right away)', async () => {
  const { src, requests } = flixWith(async u => (u.includes('/search/') ? '<div class="film_list-wrap"></div>' : flixSite(u)));
  assert.deepEqual(await src.extractAll({ id: 77, type: 'movie', title: 'Not On The Site', year: 2001 }), []);
  const before = requests.length;
  await src.extractAll({ id: 77, type: 'movie', title: 'Not On The Site', year: 2001 });
  assert.equal(requests.length, before);
});

// ---------------------------------------------------------------- decrypt resolver

test('decrypt answers are searched for the stream, whatever their shape', () => {
  assert.equal(parseDecryptAnswer('{"data":{"sources":[{"file":"https://x.test/a/playlist.m3u8"}]}}')?.url, 'https://x.test/a/playlist.m3u8');
  assert.equal(parseDecryptAnswer('{"sources":[{"url":"https://x.test/b.m3u8?t=1"}],"subtitles":[{"url":"https://x.test/s.srt","lang":"English"}]}')?.subtitles[0].url, 'https://x.test/s.srt');
  assert.equal(parseDecryptAnswer('{"error":"blocked"}'), null);
  assert.equal(parseDecryptAnswer('<html>'), null);
});

test('the remote config can switch the decrypt service off even when the viewer turned it on', () => {
  saveUserPreferences({ flixhqDecryptApi: true });
  assert.equal(decryptApiEnabled(), true);
  setProviderConfig({ ...DEFAULT_PROVIDER_CONFIG, version: 9, resolvers: { 'decrypt-api': { enabled: false } } });
  assert.equal(decryptApiEnabled(), false);
});

// ---------------------------------------------------------------- Jellyfin

test('Jellyfin is unavailable until a server is set up', () => {
  assert.equal(new JellyfinSource().available(), false);
  saveUserPreferences({ jellyfinUrl: 'ftp://nope', jellyfinApiKey: 'k' });
  assert.equal(new JellyfinSource().available(), false);
  saveUserPreferences({ jellyfinUrl: 'http://192.168.1.5:8096/', jellyfinApiKey: 'k' });
  assert.equal(new JellyfinSource().available(), true);
});

test('Jellyfin: the TMDB id decides the match; the stream is a transcode on the web, the file itself natively', async () => {
  saveUserPreferences({ jellyfinUrl: 'https://jf.test', jellyfinApiKey: 'secret' });
  const src = new JellyfinSource();
  const seen: string[] = [];
  (src as unknown as { httpGet: Get }).httpGet = async (u: string) => {
    seen.push(u);
    if (u.includes('searchTerm=Dune')) return JSON.stringify({ Items: [
      { Id: 'old', Name: 'Dune', Type: 'Movie', ProductionYear: 1984, ProviderIds: { Tmdb: '841' } },
      { Id: 'm1', Name: 'Dune', Type: 'Movie', ProductionYear: 2021, ProviderIds: { Tmdb: '438631' } }
    ] });
    if (u.includes('/Items?Ids=m1')) return JSON.stringify({ Items: [{ Id: 'm1', MediaSources: [{ Id: 'ms1', Container: 'mkv', MediaStreams: [
      { Type: 'Subtitle', Index: 2, Codec: 'subrip', Language: 'eng', DisplayTitle: 'English' },
      { Type: 'Subtitle', Index: 3, Codec: 'PGSSUB', Language: 'eng' }
    ] }] }] });
    throw new Error('unexpected ' + u);
  };
  const out = await src.extractAll({ id: 438631, type: 'movie', title: 'Dune', year: 2021 });
  assert.equal(out.length, 1);
  assert.match(out[0].url, /^https:\/\/jf\.test\/Videos\/m1\/master\.m3u8\?MediaSourceId=ms1.*api_key=secret/);
  assert.deepEqual(out[0].subtitles?.map(s => s.url), ['https://jf.test/Videos/m1/ms1/Subtitles/2/0/Stream.vtt?api_key=secret']);
  const native = streamsFor({ url: 'https://jf.test', apiKey: 'secret' }, { Id: 'm1', MediaSources: [{ Id: 'ms1', Container: 'mkv' }] }, true);
  assert.equal(native[0].url, 'https://jf.test/Videos/m1/stream.mkv?static=true&MediaSourceId=ms1&api_key=secret');
  assert.equal(native[1].format, 'hls');
});

// ---------------------------------------------------------------- alternates and the planner

test('alternates: other servers first, no duplicates, no embeds, at most four', () => {
  const s = (serverId: string, n: number, embed = false): ExtractedStream => ({ url: `https://${serverId}/${n}.m3u8`, format: 'hls', serverId, isFallbackEmbed: embed });
  const chosen = s('a', 1);
  const alts = pickAlternates(chosen, [chosen, s('a', 2), s('b', 1), s('b', 1), s('c', 1, true), s('d', 1), s('e', 1), s('f', 1)]);
  assert.deepEqual(alts.map(a => a.url), ['https://b/1.m3u8', 'https://d/1.m3u8', 'https://e/1.m3u8', 'https://f/1.m3u8']);
});

test('planner: Kunai first, then the provider that suits the title (kind / original language)', async () => {
  const reg = new ExtractorRegistry(true);
  const mk = (id: string) => ({ url: `https://cdn.test/${id}.m3u8`, format: 'hls' as const, serverId: id });
  assert.equal((await reg.resolveBestStream({ id: 30, type: 'movie' }, [mk('vega'), mk('rivestream'), mk('flixhq')]))?.serverId, 'rivestream');
  assert.equal((await reg.resolveBestStream({ id: 31, type: 'movie', language: 'en' }, [mk('movierulz'), mk('vega')]))?.serverId, 'vega');
  assert.equal((await reg.resolveBestStream({ id: 32, type: 'movie', language: 'te' }, [mk('vega'), mk('movierulz')]))?.serverId, 'movierulz');
  assert.equal((await reg.resolveBestStream({ id: 33, type: 'tv' }, [mk('vega'), mk('flixeo')]))?.serverId, 'flixeo');
});

const delay = <T,>(ms: number, v: T) => new Promise<T>(r => setTimeout(() => r(v), ms));
function fake(id: string, manifest: StreamExtractor['manifest'], run: () => Promise<ExtractedStream | null>): StreamExtractor & { startedAt: number } {
  const e = { id, name: id, mainUrl: `https://${id}`, manifest, startedAt: 0, extract() { e.startedAt = Date.now(); return run(); } };
  return e;
}

test('planner: expensive providers join after the cheap ones\' usual time, not a fixed 3.5 s', async () => {
  const reg = new ExtractorRegistry(false);
  const t0 = Date.now();
  reg.register(fake('k1', { idKind: 'tmdb', costHint: 'api', priorMs: 400 }, () => delay(4000, null)));
  reg.register(fake('k2', { idKind: 'tmdb', costHint: 'api', priorMs: 900 }, () => delay(4000, null)));
  const slow = fake('emb', { idKind: 'tmdb', costHint: 'sniff' }, async () => ({ url: 'https://emb/x.m3u8', format: 'hls' }));
  reg.register(slow);
  const out = await reg.resolveAllStreams({ id: 40, type: 'movie', fresh: true, allowSniff: false });
  assert.equal(out[0].serverId, 'emb');
  const joinedAfter = slow.startedAt - t0;
  assert.ok(joinedAfter >= 1200 && joinedAfter < 1800, `expensive tier joined after ${joinedAfter} ms (expected ~1.35 s)`);
});

test('a provider that reports every server hands all of them over, embeds included', async () => {
  const reg = new ExtractorRegistry(false);
  reg.register({
    id: 'multi', name: 'Multi', mainUrl: 'https://multi',
    extract: async () => null,
    extractAll: async () => [
      { url: 'https://multi/a.m3u8', format: 'hls', serverName: 'Multi A' },
      { url: 'https://multi/b.m3u8', format: 'hls', serverName: 'Multi B' },
      { url: 'https://multi/embed/1', format: 'hls', isFallbackEmbed: true }
    ]
  });
  const embeds: string[] = [];
  const out = await reg.resolveAllStreams({ id: 41, type: 'movie', fresh: true, allowSniff: false, onEmbed: e => embeds.push(e.url) });
  assert.deepEqual(out.map(s => s.url), ['https://multi/a.m3u8', 'https://multi/b.m3u8']);
  assert.ok(out.every(s => s.serverId === 'multi'));
  assert.deepEqual(embeds, ['https://multi/embed/1']);
});
