// smoke.mjs - Walks the built web app in a headless browser and fails on any crash.
//
//   npm run build            (needs VITE_TMDB_API_KEY set to anything)
//   npm i --no-save playwright-core
//   CHROME_PATH=/path/to/chrome node scripts/smoke.mjs
//
// TMDB, images and every streaming host are stubbed, so it runs offline and deterministically. It
// opens each tab, searches, opens a title page and presses Play, and exits non-zero when the page
// throws an uncaught error or a screen renders nothing. Screenshots land in ./smoke-shots.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); } catch {
  console.error('playwright-core is not installed: run `npm i --no-save playwright-core` first.');
  process.exit(2);
}
const executablePath = process.env.CHROME_PATH;
if (!executablePath) { console.error('Set CHROME_PATH to a Chrome/Chromium binary.'); process.exit(2); }

const DIST = join(process.cwd(), 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const file = path === '/' || path === '\\' ? 'index.html' : path.slice(1);
    const body = await readFile(join(DIST, file));
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, r));
const origin = `http://localhost:${server.address().port}/`;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const item = i => ({ id: 1000 + i, title: `Movie ${i}`, name: `Show ${i}`, poster_path: `/p${i}.jpg`, backdrop_path: `/b${i}.jpg`, overview: `Overview ${i}`, release_date: '2024-01-01', first_air_date: '2024-02-01', vote_average: 7.5, genre_ids: [28, 12], media_type: i % 2 ? 'tv' : 'movie', original_language: 'en' });
const list = Array.from({ length: 20 }, (_, i) => item(i));
const tmdb = () => ({
  page: 1, total_pages: 5, total_results: 100, results: list, ...item(1),
  genres: [{ id: 28, name: 'Action' }], runtime: 120, number_of_seasons: 2,
  seasons: [{ season_number: 1, name: 'Season 1', episode_count: 3 }],
  episodes: [1, 2, 3].map(n => ({ id: n, episode_number: n, season_number: 1, name: `Episode ${n}`, overview: 'x', runtime: 45 })),
  credits: { cast: list.slice(0, 4).map(c => ({ id: c.id, name: `Actor ${c.id}`, character: 'Role' })) },
  videos: { results: [] }, recommendations: { results: list.slice(0, 8) }, similar: { results: list.slice(0, 8) }
});

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(`uncaught: ${e.message.split('\n')[0]}`));
// Playwright tries the most recently added route first: the catch-all must be added first.
await page.route(/^https?:\/\/(?!localhost)/, r => r.abort());
await page.route(/api\.themoviedb\.org/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tmdb()) }));
await page.route(/image\.tmdb\.org/, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
await mkdir('smoke-shots', { recursive: true });

const results = [];
async function step(name, fn) {
  const before = problems.length;
  try { await fn(); await page.waitForTimeout(800); results.push(`ok    ${name}`); }
  catch (e) { problems.push(`${name}: ${e.message.split('\n')[0]}`); results.push(`FAIL  ${name}`); }
  if (problems.length > before) results[results.length - 1] += `  (+${problems.length - before} problems)`;
}
const visibleText = async () => (await page.evaluate(() => document.body.innerText)).trim().length;

await step('home renders', async () => { await page.goto(origin, { waitUntil: 'load' }); await page.waitForSelector('img', { timeout: 10000 }); await page.screenshot({ path: 'smoke-shots/home.png' }); });
for (const tab of ['Search', 'Library', 'Settings', 'Home']) {
  await step(`tab ${tab}`, async () => {
    await page.getByText(tab, { exact: true }).last().click();
    await page.waitForTimeout(1200);
    if ((await visibleText()) < 20) throw new Error('screen is blank');
    await page.screenshot({ path: `smoke-shots/${tab.toLowerCase()}.png` });
  });
}
await step('search finds titles', async () => {
  await page.getByText('Search', { exact: true }).last().click();
  await page.locator('input').first().fill('movie');
  await page.waitForTimeout(1500);
  if (!(await page.getByText(/Movie \d|Show \d/).count())) throw new Error('no results shown');
});
await step('title page opens', async () => {
  await page.getByText('Home', { exact: true }).last().click();
  await page.getByText('Info', { exact: true }).first().click();
  await page.waitForTimeout(1200);
  if (!(await page.getByText(/Overview/).count())) throw new Error('title page empty');
});
await step('Play ends in a player or a clear error, never a blank page', async () => {
  await page.getByText(/^(Play|Resume|Rewatch)/).last().click();
  await page.waitForTimeout(5000);
  if ((await visibleText()) < 10) throw new Error('blank after Play');
});

console.log(results.join('\n'));
if (problems.length) console.log('\nProblems:\n' + [...new Set(problems)].map(p => `  - ${p}`).join('\n'));
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
