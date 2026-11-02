// test-direct-only.ts - Offline checks that ExoPlayer is only ever given direct stream data.
// Run: npx tsx scripts/test-direct-only.ts
import { ExtractorRegistry } from '../src/extractors/extractorRegistry.ts';
import { discover } from '../src/extractors/streamDiscovery.ts';
import type { StreamExtractor, ExtractedStream } from '../src/extractors/types.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failures++;
}

const params = { id: 1, type: 'movie' as const };
const embedProvider = (id: string): StreamExtractor => ({
  id, name: id, mainUrl: `https://${id}.test`,
  extract: async () => ({ url: `https://${id}.test/embed/1`, format: 'hls', isFallbackEmbed: true, serverId: id })
});
const directProvider = (id: string): StreamExtractor => ({
  id, name: id, mainUrl: `https://${id}.test`,
  extract: async () => ({ url: `https://cdn.${id}.test/master.m3u8`, format: 'hls', serverId: id })
});
const sniffTo = (hits: Record<string, string>) => async (e: ExtractedStream): Promise<ExtractedStream | null> =>
  hits[e.serverId!] ? { url: hits[e.serverId!], format: 'hls', serverId: e.serverId } : null;

async function run() {
  // 1. Direct providers win and nothing is sniffed.
  let r = new ExtractorRegistry(false);
  r.register(embedProvider('a')); r.register(directProvider('b'));
  let sniffed = 0;
  r.setSniffer(async () => { sniffed++; return null; });
  let all = await r.resolveAllStreams({ ...params, directOnly: true });
  check('direct provider returned, embeds dropped', all.length === 1 && !all[0].isFallbackEmbed);
  check('sniffer not used when a direct stream exists', sniffed === 0);

  // 2. Only embeds: sniffer upgrades the first that yields a stream.
  r = new ExtractorRegistry(false);
  r.register(embedProvider('a')); r.register(embedProvider('b'));
  r.setSniffer(sniffTo({ b: 'https://cdn.b.test/index.m3u8' }));
  all = await r.resolveAllStreams({ ...params, directOnly: true });
  check('embed upgraded to direct stream via sniffer', all.length === 1 && all[0].url.endsWith('.m3u8') && !all[0].isFallbackEmbed);

  // 3. Nothing sniffable: no iframe link is ever returned.
  r = new ExtractorRegistry(false);
  r.register(embedProvider('a'));
  r.setSniffer(sniffTo({}));
  all = await r.resolveAllStreams({ ...params, directOnly: true });
  const best = await r.resolveBestStream({ ...params, directOnly: true }, all);
  check('no iframe link returned when sniffing fails', all.length === 0 && best === null);

  // 4. Web (directOnly false) still allows embeds.
  all = await r.resolveAllStreams({ ...params, directOnly: false });
  check('embeds allowed when directOnly is false', all.length === 1 && Boolean(all[0].isFallbackEmbed));

  // 5. Static discovery: iframe wrapper yields a page to follow, JSON yields a stream.
  const wrap = discover('<iframe src="//player.test/embed/1"></iframe>', 'https://host.test/x');
  check('iframe wrapper -> follow-up page, no stream', wrap.streams.length === 0 && wrap.pages[0] === 'https://player.test/embed/1');
  const json = discover('{"sources":[{"file":"https:\\/\\/cdn.test\\/v\\/master.m3u8"}]}', 'https://host.test/api');
  check('JSON API -> direct m3u8 stream', json.streams.length === 1 && json.streams[0].url === 'https://cdn.test/v/master.m3u8');
  const packed = discover('<script>var u="https://cdn.test/a.mp4";</script>', 'https://host.test/');
  check('inline script -> direct mp4 stream', packed.streams.length === 1);

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}
run();
