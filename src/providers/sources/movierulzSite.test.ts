import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRelease, parseReleases, releasesOf, slugOf, streamLinks } from './movierulzSite.ts';

const SITE = 'https://www.5movierulz.test';

test('a release address gives title, year, language and post number', () => {
  assert.deepEqual(parseRelease(`${SITE}/kalki-2898-ad-2024-telugu/movie-watch-online-free-3222.html`), {
    url: `${SITE}/kalki-2898-ad-2024-telugu/movie-watch-online-free-3222.html`, id: 3222, name: 'kalki-2898-ad', year: 2024, language: 'Telugu'
  });
  const dubbed = parseRelease(`${SITE}/avengers-endgame-encore-2026-hdrip-telugu-dubbed-7752.html`);
  assert.deepEqual([dubbed?.name, dubbed?.year, dubbed?.language, dubbed?.id], ['avengers-endgame-encore', 2026, 'Telugu', 7752]);
  // The year is the last one in the address.
  assert.equal(parseRelease(`${SITE}/blade-runner-2049-2017-hindi/movie-watch-online-free-12.html`)?.name, 'blade-runner-2049');
  assert.equal(parseRelease(`${SITE}/category/telugu-movies-2024`), null);
});

test('a category page is read from its list only, in page order', () => {
  const html = `
    <a href="${SITE}/latest-2026-hdrip-tamil-9000.html">side box</a>
    <div id="list" class="films">
      <a href="${SITE}/amaran-2024-tamil/movie-watch-online-free-3731.html">Amaran</a>
      <a href="${SITE}/amaran-2024-tamil/movie-watch-online-free-3731.html"><img></a>
      <a href="${SITE}/other-2024-tamil/movie-watch-online-free-3720.html">Other</a>
    </div><div class="pagination"><a href="${SITE}/category/tamil-movies-2024/page/2">2</a></div>
    <a href="${SITE}/footer-2026-hdrip-hindi-9001.html">footer box</a>`;
  assert.deepEqual(parseReleases(html, true).map(r => r.id), [3731, 3720]);
  assert.equal(parseReleases(html).length, 4);
});

test('the releases of a title: one per language, same year, exact title first', () => {
  const all = [
    'pushpa-2-the-rule-reloaded-2024-telugu/movie-watch-online-free-4163',
    'pushpa-2-the-rule-reloaded-2024-hindi/movie-watch-online-free-4165',
    'pushpa-the-rise-2021-telugu/movie-watch-online-free-900',
    'amaran-2024-tamil/movie-watch-online-free-3731',
    'amaran-2024-telugu/movie-watch-online-free-3850',
    'amaran-2-2024-tamil/movie-watch-online-free-3999',
    'amaran-2010-tamil/movie-watch-online-free-11'
  ].map(p => parseRelease(`${SITE}/${p}.html`)!);
  assert.equal(slugOf('Pushpa 2: The Rule'), 'pushpa-2-the-rule');
  assert.deepEqual(releasesOf(all, 'Pushpa 2: The Rule', 2024).map(r => r.language), ['Telugu', 'Hindi']);
  assert.deepEqual(releasesOf(all, 'Amaran', 2024).map(r => r.id), [3731, 3850]);
  assert.deepEqual(releasesOf(all, 'Unknown Film', 2024), []);
});

test('player links come from the stream buttons, cleaned of stray line breaks', () => {
  const html = `
    <a href="https://ww7.vcdnlare.test/v/\rabc?sid=1&amp;t=hls" class="stream-link-btn" target="_blank">Watch</a>
    <a class="stream-link-btn" href="https://minochinos.test/f/xyz">Watch</a>
    <a href="${SITE}/category/telugu-featured">Telugu</a>`;
  assert.deepEqual(streamLinks(html), ['https://ww7.vcdnlare.test/v/abc?sid=1&t=hls', 'https://minochinos.test/f/xyz']);
});

test('a bare file name in a player page is not taken for the stream', async () => {
  const { discover } = await import('../core/streamDiscovery.ts');
  const page = '<title>Kalki 2898 AD (2024) Telugu HQ HDRip - 700MB - ESub.mp4</title><script>var src="https://cdn.test/v/master.m3u8";</script>';
  assert.deepEqual(discover(page, 'https://player.test/v/abc').streams.map(s => s.url), ['https://cdn.test/v/master.m3u8']);
});
