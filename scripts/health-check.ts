// health-check.ts - Live check of every stream provider, run daily by .github/workflows/health-check.yml.
// Run: npx tsx scripts/health-check.ts
//
// Each provider is asked for a few well-known titles. A provider that hands out direct streams is
// healthy when at least one title gives one; an embed-only provider when it answers at all. The run
// fails (and GitHub mails the repository owner) when a provider that should give direct streams
// gives none - usually the site has moved or changed, which provider-config.json or a release fixes.
import { appendFileSync } from 'node:fs';
import { MovierulzExtractor } from '../src/providers/sources/movierulz.ts';
import { FlixeoExtractor } from '../src/providers/sources/flixeo.ts';
import { VegaExtractor } from '../src/providers/sources/vega.ts';
import { CineHypeExtractor } from '../src/providers/sources/cinehype.ts';
import { VidLinkExtractor } from '../src/providers/sources/vidlink.ts';
import { VidRockExtractor } from '../src/providers/sources/vidrock.ts';
import { RivestreamExtractor } from '../src/providers/sources/rivestream.ts';
import { MovyExtractor } from '../src/providers/sources/movy.ts';
import type { StreamExtractor } from '../src/providers/core/types.ts';

interface Title { name: string; id: number; type: 'movie' | 'tv'; season?: number; episode?: number; year?: number; language?: string }
const WORLD: Title[] = [
  { name: 'Fight Club', id: 550, type: 'movie', year: 1999, language: 'en' },
  { name: 'Interstellar', id: 157336, type: 'movie', year: 2014, language: 'en' },
  { name: 'Stranger Things', id: 66732, type: 'tv', season: 1, episode: 1, language: 'en' }
];
const REGIONAL: Title[] = [
  { name: 'Kalki 2898-AD', id: 801688, type: 'movie', year: 2024, language: 'te' },
  { name: 'Maharaja', id: 1160018, type: 'movie', year: 2024, language: 'ta' }
];

// `direct`: the provider is expected to hand out a playable stream by itself (no WebView needed).
const providers: Array<{ extractor: StreamExtractor; direct: boolean; titles: Title[] }> = [
  { extractor: new VidLinkExtractor(), direct: true, titles: WORLD },
  { extractor: new VidRockExtractor(), direct: true, titles: WORLD },
  { extractor: new RivestreamExtractor(), direct: true, titles: WORLD },
  { extractor: new MovyExtractor(), direct: true, titles: WORLD },
  { extractor: new MovierulzExtractor(), direct: true, titles: REGIONAL },
  { extractor: new CineHypeExtractor(), direct: false, titles: WORLD },
  { extractor: new FlixeoExtractor(), direct: false, titles: WORLD },
  { extractor: new VegaExtractor(), direct: false, titles: WORLD }
];

const rows: string[] = [];
let broken = 0;
for (const { extractor, direct, titles } of providers) {
  let directs = 0;
  let answers = 0;
  const notes: string[] = [];
  for (const t of titles) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    const t0 = Date.now();
    try {
      const s = await extractor.extract({ ...t, title: t.name, signal: ac.signal } as Parameters<StreamExtractor['extract']>[0]);
      if (s) answers++;
      if (s && !s.isFallbackEmbed) directs++;
      notes.push(`${t.name}: ${!s ? 'nothing' : s.isFallbackEmbed ? 'embed' : 'direct'}${s?.audios ? ` (${s.audios.length} audios)` : ''} ${Date.now() - t0}ms`);
    } catch (e) {
      notes.push(`${t.name}: error ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  const ok = direct ? directs > 0 : answers > 0;
  if (!ok) broken++;
  const line = `${ok ? 'OK  ' : 'FAIL'} ${extractor.id.padEnd(11)} ${direct ? `${directs}/${titles.length} direct` : `${answers}/${titles.length} answered`}`;
  console.log(line);
  notes.forEach(n => console.log(`       ${n}`));
  rows.push(`| ${ok ? '✅' : '❌'} | ${extractor.id} | ${direct ? `${directs}/${titles.length} direct` : `${answers}/${titles.length} answered`} | ${notes.join('<br>')} |`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## CineStream providers\n\n| | Provider | Result | Details |\n|---|---|---|---|\n${rows.join('\n')}\n`);
}
console.log(broken ? `\n${broken} provider(s) are not giving streams` : '\nAll providers healthy');
process.exit(broken ? 1 : 0);
