import test from 'node:test';
import assert from 'node:assert/strict';
import { SniffQueue } from './sniffQueue.ts';
import type { ExtractedStream } from '../core/types.ts';

const page = (serverId: string, n = 1): ExtractedStream => ({ url: `https://${serverId}.test/${n}`, format: 'hls', isFallbackEmbed: true, serverId });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

test('pages go best first (favourite, then expected time); a page is queued once', async () => {
  const order: string[] = [];
  const q = new SniffQueue({
    sniff: async e => { order.push(e.serverId!); return null; },
    onResult: () => {}, expectedMs: id => ({ a: 3000, b: 1000, c: 2000 })[id] ?? 4000, hedgeDelayMs: () => 0,
    favouriteId: 'c', concurrency: 1, unhedged: 1
  });
  [page('a'), page('b'), page('c'), page('a')].forEach(e => q.add(e));
  q.pump();
  await wait(20);
  assert.deepEqual(order, ['c', 'b', 'a']);
});

test('two run at once; a third waits for the hedge delay; never more than the attempt budget', async () => {
  let running = 0, peak = 0, started = 0;
  const q = new SniffQueue({
    sniff: async () => { started++; running++; peak = Math.max(peak, running); await wait(80); running--; return null; },
    onResult: () => {}, expectedMs: () => 1000, hedgeDelayMs: () => 40, maxAttempts: 4, concurrency: 3, unhedged: 2
  });
  for (let i = 0; i < 6; i++) q.add(page('s', i));
  q.pump();
  await wait(10);
  assert.equal(running, 2, 'the hedged third has not started yet');
  await wait(50);
  assert.equal(running, 3);
  await wait(300);
  assert.equal(started, 4);
  assert.ok(q.exhausted && q.settled);
  assert.equal(peak, 3);
});

test('a stopped queue reports nothing (a cancelled sniff is not a provider failure)', async () => {
  const results: unknown[] = [];
  const q = new SniffQueue({ sniff: async () => { await wait(30); return null; }, onResult: (_e, s) => results.push(s), expectedMs: () => 0, hedgeDelayMs: () => 0 });
  q.add(page('x'));
  q.pump();
  q.stop();
  await wait(60);
  assert.deepEqual(results, []);
});
