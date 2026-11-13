// bench-providers.ts - times each extractor on its own and reports direct stream vs iframe embed.
import { MovierulzExtractor } from '../src/providers/extractors/movierulzExtractor.ts';
import { FlixeoExtractor } from '../src/providers/extractors/flixeoExtractor.ts';
import { VegaExtractor } from '../src/providers/extractors/vegaExtractor.ts';
import { CineHypeExtractor } from '../src/providers/extractors/cinehypeExtractor.ts';
import type { StreamExtractor } from '../src/providers/extractors/types.ts';

import { VidLinkExtractor } from '../src/providers/extractors/vidlinkExtractor.ts';
import { VidRockExtractor } from '../src/providers/extractors/vidrockExtractor.ts';
import { RivestreamExtractor } from '../src/providers/extractors/rivestreamExtractor.ts';
import { MovyExtractor } from '../src/providers/extractors/movyExtractor.ts';
const extra: StreamExtractor[] = [new VidLinkExtractor(), new VidRockExtractor(), new RivestreamExtractor(), new MovyExtractor()];

const providers: StreamExtractor[] = [...extra, new CineHypeExtractor(), new FlixeoExtractor(), new VegaExtractor(), new MovierulzExtractor()];
const only = process.argv[2];
const titles = [
  { name: 'Fight Club', id: 550, type: 'movie' as const },
  { name: 'Interstellar', id: 157336, type: 'movie' as const },
  { name: 'Stranger Things S1E1', id: 66732, type: 'tv' as const, season: 1, episode: 1 },
  { name: 'Game of Thrones S1E1', id: 1399, type: 'tv' as const, season: 1, episode: 1 },
];
for (const p of providers.filter(p => !only || p.id === only || (only === 'kunai' && (p as { tier?: string }).tier === 'primary'))) {
  console.log(`\n== ${p.id}`);
  for (const t of titles) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    const t0 = Date.now();
    try {
      const s = await p.extract({ id: t.id, type: t.type, season: (t as any).season, episode: (t as any).episode, title: t.name, signal: ac.signal });
      const ms = Date.now() - t0;
      const kind = !s ? 'NONE' : s.isFallbackEmbed ? 'IFRAME' : 'DIRECT';
      console.log(`  ${t.name.padEnd(24)} ${String(ms).padStart(6)}ms ${kind} ${s ? s.format + ' subs=' + (s.subtitles?.length ?? 0) + ' ' + s.url.slice(0, 80) : ''}`);
    } catch (e: any) {
      console.log(`  ${t.name.padEnd(24)} ${String(Date.now() - t0).padStart(6)}ms ERROR ${e.message}`);
    } finally { clearTimeout(timer); }
  }
}
process.exit(0);
