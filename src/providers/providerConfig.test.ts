import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); }
};
const cfg = await import('./providerConfig.ts');
const { ExtractorRegistry } = await import('./extractors/extractorRegistry.ts');
const { ApiExtractor, readPath } = await import('./extractors/apiExtractor.ts');
const { decide } = await import('./speculation.ts');

beforeEach(() => mem.clear());
afterEach(() => cfg.setProviderConfig(cfg.DEFAULT_PROVIDER_CONFIG));

test('config validation: https only, no credentials, bounded; bad file is rejected', () => {
  assert.equal(cfg.parseProviderConfig({ nope: 1 }), null);
  const c = cfg.parseProviderConfig({
    version: 3,
    providers: {
      vega: { enabled: false, mainUrl: 'https://ok.example.com/', mirrors: ['https://a.example', 'http://insecure.example', 'https://user:pw@evil.example'], bias: 99999 },
      'BAD ID': { enabled: false }
    },
    apiProviders: [
      { id: 'mine', name: 'Mine', movieUrl: 'https://api.example.com/m/{tmdbId}', streamPath: 'a.b.0.url' },
      { id: 'http', name: 'x', movieUrl: 'http://api.example.com/{tmdbId}', streamPath: 'a' },
      { id: 'badpath', name: 'x', movieUrl: 'https://api.example.com/{tmdbId}', streamPath: 'a b' }
    ]
  })!;
  assert.equal(c.providers.vega.enabled, false);
  assert.equal(c.providers.vega.mainUrl, 'https://ok.example.com');
  assert.deepEqual(c.providers.vega.mirrors, ['https://a.example']);
  assert.equal(c.providers.vega.bias, 5000);
  assert.equal(c.providers['BAD ID'], undefined);
  assert.deepEqual(c.apiProviders.map(a => a.id), ['mine']);
});

test('kill switch removes a provider from the registry; host override reaches the extractor', () => {
  const reg = new ExtractorRegistry(true);
  assert.equal(reg.getAllExtractors().length, 9);
  cfg.setProviderConfig({ version: 1, providers: { vega: { enabled: false } }, apiProviders: [] });
  assert.deepEqual(reg.getAllExtractors().map(e => e.id).sort(), ['cinehype', 'flixeo', 'flixhq', 'movierulz', 'movy', 'rivestream', 'vidlink', 'vidrock']);
  cfg.setProviderConfig({ version: 2, providers: { flixeo: { mainUrl: 'https://new.flixeo.example' } }, apiProviders: [] });
  assert.equal(reg.getAllExtractors().find(e => e.id === 'flixeo')!.mainUrl, 'https://new.flixeo.example');
  assert.equal(reg.getAllExtractors().length, 9);
});

test('API providers from config are added, then dropped when removed', () => {
  const reg = new ExtractorRegistry(true);
  const spec = { id: 'mine', name: 'Mine', movieUrl: 'https://api.example.com/m/{tmdbId}', streamPath: 'a.url' };
  cfg.setProviderConfig({ version: 1, providers: {}, apiProviders: [spec] });
  assert.ok(reg.getAllExtractors().some(e => e.id === 'mine'));
  cfg.setProviderConfig({ version: 2, providers: {}, apiProviders: [] });
  assert.ok(!reg.getAllExtractors().some(e => e.id === 'mine'));
  assert.equal(reg.getAllExtractors().length, 9);
});

test('the API extractor returns a direct https stream from the configured path, and never an embed', async () => {
  assert.equal(readPath({ a: { b: [{ c: 'x' }] } }, 'a.b.0.c'), 'x');
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string) => { calls.push(String(u)); return { ok: true, status: 200, text: async () => JSON.stringify({ data: { sources: [{ url: 'https://cdn.example.com/v/index.m3u8' }] } }) }; }) as unknown as typeof fetch;
  try {
    const ex = new ApiExtractor({ id: 'mine', name: 'Mine', movieUrl: 'https://api.example.com/m/{tmdbId}', tvUrl: 'https://api.example.com/t/{tmdbId}/{season}/{episode}', streamPath: 'data.sources.0.url' });
    const movie = await ex.extract({ id: 155, type: 'movie' });
    assert.equal(movie?.url, 'https://cdn.example.com/v/index.m3u8');
    assert.ok(!movie?.isFallbackEmbed);
    await ex.extract({ id: 1399, type: 'tv', season: 2, episode: 3 });
    assert.deepEqual(calls, ['https://api.example.com/m/155', 'https://api.example.com/t/1399/2/3']);
    globalThis.fetch = (async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { sources: [{ url: 'http://insecure/x.m3u8' }] } }) })) as unknown as typeof fetch;
    assert.equal(await ex.extract({ id: 1, type: 'movie' }), null);
  } finally { globalThis.fetch = realFetch; }
});

test('a saved config is used at once; a newer download replaces it, an older one does not', async () => {
  const body = (version: number, enabled: boolean) => ({ version, providers: { vega: { enabled } }, apiProviders: [] });
  const fetchOf = (b: unknown) => (async () => ({ ok: true, json: async () => b })) as unknown as typeof fetch;
  await cfg.loadProviderConfig('https://cfg.example.com/p.json', fetchOf(body(5, false)));
  assert.equal(cfg.isProviderEnabled('vega'), false);
  // Saved copy is fresh: no download is even attempted.
  cfg.setProviderConfig(cfg.DEFAULT_PROVIDER_CONFIG);
  await cfg.loadProviderConfig('https://cfg.example.com/p.json', (async () => { throw new Error('should not fetch'); }) as unknown as typeof fetch);
  assert.equal(cfg.isProviderEnabled('vega'), false);
  // Force a refresh; an older version is ignored.
  const saved = JSON.parse(mem.get('cinestream_provider_config_v1')!); saved.fetchedAt = 0; mem.set('cinestream_provider_config_v1', JSON.stringify(saved));
  await cfg.loadProviderConfig('https://cfg.example.com/p.json', fetchOf(body(2, true)));
  assert.equal(cfg.isProviderEnabled('vega'), false);
  saved.fetchedAt = 0; mem.set('cinestream_provider_config_v1', JSON.stringify(saved));
  await cfg.loadProviderConfig('https://cfg.example.com/p.json', fetchOf(body(6, true)));
  assert.equal(cfg.isProviderEnabled('vega'), true);
  // Unreachable: keeps what it has.
  saved.fetchedAt = 0; mem.set('cinestream_provider_config_v1', JSON.stringify({ ...JSON.parse(mem.get('cinestream_provider_config_v1')!), fetchedAt: 0 }));
  await cfg.loadProviderConfig('https://cfg.example.com/p.json', (async () => { throw new Error('offline'); }) as unknown as typeof fetch);
  assert.equal(cfg.isProviderEnabled('vega'), true);
});

test('speculation only when harmless: native, visible, idle, battery ok, Faster Start on - on Wi-Fi or mobile data', () => {
  const ok = { native: true, visible: true, playing: false, preloadStreams: true, dataSaver: false, metered: false, saveData: false, battery: { level: 0.8, charging: false } };
  assert.equal(decide(ok), true);
  assert.equal(decide({ ...ok, native: false }), false);
  assert.equal(decide({ ...ok, playing: true }), false);
  assert.equal(decide({ ...ok, visible: false }), false);
  assert.equal(decide({ ...ok, preloadStreams: false }), false);
  assert.equal(decide({ ...ok, dataSaver: true }), false);
  assert.equal(decide({ ...ok, metered: true }), true, 'mobile data is allowed');
  assert.equal(decide({ ...ok, saveData: true }), false);
  assert.equal(decide({ ...ok, battery: { level: 0.1, charging: false } }), false);
  assert.equal(decide({ ...ok, battery: { level: 0.1, charging: true } }), true);
  assert.equal(decide({ ...ok, battery: null }), true);
});

test('the next episode is prepared while the player is open, within the same limits', () => {
  const playing = { native: true, visible: false, playing: true, preloadStreams: true, dataSaver: false, metered: true, saveData: false, battery: { level: 0.8, charging: false }, nextEpisode: true };
  assert.equal(decide(playing), true);
  assert.equal(decide({ ...playing, nextEpisode: false }), false, 'anything else waits until nothing plays');
  assert.equal(decide({ ...playing, preloadStreams: false }), false);
  assert.equal(decide({ ...playing, saveData: true }), false);
  assert.equal(decide({ ...playing, battery: { level: 0.1, charging: false } }), false);
});
