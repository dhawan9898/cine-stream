import test from 'node:test';
import assert from 'node:assert/strict';
import { CHEAP_HEAD_START_MAX_MS, CHEAP_HEAD_START_MIN_MS, LAST_GOOD_HEAD_START_MS, planRace } from './planner.ts';
import type { SourceManifest, StreamExtractor } from '../core/types.ts';

const p = (id: string, manifest: Partial<SourceManifest> = {}, embed?: string): StreamExtractor => ({
  id, name: id, mainUrl: `https://${id}`, manifest: { idKind: 'tmdb', costHint: 'api', ...manifest } as SourceManifest,
  extract: async () => null, ...(embed ? { embedUrl: () => embed } : {})
});
const ms: Record<string, number> = { fast: 500, mid: 1500, slow: 6000, scraper: 4000, regional: 5000 };
const inputs = (over: Partial<Parameters<typeof planRace>[2]> = {}) => ({ plannedMs: (e: StreamExtractor) => ms[e.id] ?? 2000, admit: () => true, ...over });
const ids = (list: StreamExtractor[]) => list.map(e => e.id);

const fast = p('fast'), mid = p('mid'), scraper = p('scraper', { costHint: 'multi-hop' }), sniffer = p('slow', { costHint: 'sniff' });
const regional = p('regional', { costHint: 'multi-hop', strongFor: { languages: ['te'] }, languagesOnly: true });
const all = [scraper, sniffer, mid, fast, regional];

test('cheap providers run alone for 1.5x the second-fastest one, best first; the expensive ones join later', () => {
  const plan = planRace(all, { id: 1, type: 'movie', language: 'en' }, inputs());
  assert.equal(plan.mode, 'cheap');
  assert.deepEqual(ids(plan.head), ['fast', 'mid']);
  assert.deepEqual(ids(plan.rest), ['scraper', 'regional', 'slow']);
  assert.equal(plan.headStartMs, 2250);
  assert.equal(planRace([fast, p('b'), scraper], { id: 1, type: 'movie' }, inputs({ plannedMs: () => 100 })).headStartMs, CHEAP_HEAD_START_MIN_MS);
  assert.equal(planRace([fast, p('b'), scraper], { id: 1, type: 'movie' }, inputs({ plannedMs: () => 9000 })).headStartMs, CHEAP_HEAD_START_MAX_MS);
});

test('a provider strong for the title\'s language starts at once and is waited for', () => {
  const plan = planRace(all, { id: 1, type: 'movie', language: 'te' }, inputs());
  assert.deepEqual(ids(plan.head), ['fast', 'mid', 'regional']);
  assert.deepEqual([...plan.strongIds], ['regional']);
});

test('last time\'s provider runs alone first; a retry (fresh) skips that shortcut', () => {
  const plan = planRace(all, { id: 1, type: 'movie' }, inputs({ lastGoodId: 'scraper' }));
  assert.equal(plan.mode, 'last-good');
  assert.deepEqual(ids(plan.head), ['scraper']);
  assert.equal(plan.headStartMs, LAST_GOOD_HEAD_START_MS);
  assert.equal(planRace(all, { id: 1, type: 'movie', fresh: true }, inputs({ lastGoodId: 'scraper' })).mode, 'cheap');
  assert.equal(planRace(all, { id: 1, type: 'movie' }, inputs({ lastGoodId: 'gone' })).mode, 'cheap', 'not among the usable ones');
});

test('a picked server runs first with everyone at once, and nobody is waited for', () => {
  const plan = planRace(all, { id: 1, type: 'movie', language: 'te', preferredServerId: 'slow' }, inputs({ lastGoodId: 'fast' }));
  assert.equal(plan.mode, 'preferred');
  assert.equal(plan.head[0].id, 'slow');
  assert.equal(plan.rest.length, 0);
  assert.equal(plan.strongIds.size, 0);
});

test('excluded providers and open breakers sit out, unless nobody would be left; excluded pages are blocked', () => {
  const withPage = p('paged', {}, 'https://player.test/1');
  const plan = planRace([fast, withPage, scraper], { id: 1, type: 'movie', exclude: ['paged'] }, inputs({ admit: e => e.id !== 'scraper' }));
  assert.deepEqual(ids([...plan.head, ...plan.rest]), ['fast']);
  assert.deepEqual([...plan.blockedEmbeds], ['https://player.test/1']);
  const lone = planRace([withPage], { id: 1, type: 'movie', exclude: ['paged'] }, inputs({ admit: () => false }));
  assert.deepEqual(ids(lone.head), ['paged']);
  assert.equal(lone.blockedEmbeds.size, 0);
});

test('all cheap (or none cheap): everyone at once', () => {
  assert.equal(planRace([fast, mid], { id: 1, type: 'movie' }, inputs()).mode, 'all');
  assert.equal(planRace([scraper, sniffer], { id: 1, type: 'movie' }, inputs()).headStartMs, 0);
});
