// test-variants.ts - Offline checks for multi-audio / multi-quality discovery.
// Run: npx tsx scripts/test-variants.ts
import { buildVariantSet, extractCandidates, hintOf } from '../src/providers/extractors/variantDiscovery.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${ok ? '' : ' ' + detail}`);
  if (!ok) failures++;
};

check('hint: language + quality', JSON.stringify(hintOf('Telugu 1080p HD')) === JSON.stringify({ language: 'Telugu', quality: '1080p' }));
check('hint: quality from url', hintOf('https://cdn.test/movie_720p.mp4').quality === '720p');
check('hint: alias', hintOf('Hin 480p').language === 'Hindi');

const page = `
  <a href="https://streamwish.test/e/aaa">Telugu 1080p</a>
  <a href="https://streamwish.test/e/bbb">Telugu 720p</a>
  <a href="https://filelions.test/v/ccc">Hindi 720p</a>
  <a href="https://filelions.test/v/ddd">Tamil 480p</a>
  <a href="/about">About us</a>
`;
const cands = extractCandidates(page, 'https://site.test/movie/');
check('candidates: only stream links, 4 found', cands.length === 4, String(cands.length));

const resolved = cands.map((c, i) => ({ url: `https://cdn.test/${i}.m3u8`, hint: c.hint }));
const set = buildVariantSet(resolved, 'te')!;
check('primary is Telugu 1080p', set.primary.hint.language === 'Telugu' && set.primary.hint.quality === '1080p');
check('audio list has Telugu, Hindi, Tamil', set.audios.map(a => a.label).sort().join() === 'Hindi,Tamil,Telugu');
check('quality list for primary language: 1080p, 720p', set.qualities.map(q => q.quality).join() === '1080p,720p');
check('Hindi preferred when asked', buildVariantSet(resolved, 'hi')!.primary.hint.language === 'Hindi');
check('single-language page offers no audio menu', buildVariantSet(resolved.slice(0, 2), 'te')!.audios.length === 0);
check('empty input -> null', buildVariantSet([], 'te') === null);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
