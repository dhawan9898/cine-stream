import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); }
};
const { recordTiming, clearTimings, summarize, formatTimingReport, statsOf } = await import('./streamTimings.ts');

beforeEach(() => clearTimings());

test('statsOf gives median, p90 and max', () => {
  const s = statsOf([100, 200, 300, 400, 1000]);
  assert.deepEqual([s.count, s.median, s.max], [5, 300, 1000]);
  assert.equal(s.p90, 400);
});

test('summary splits time to embed from time to stream, per provider', () => {
  recordTiming({ phase: 'extract', ms: 800, serverId: 'vega', outcome: 'embed' });
  recordTiming({ phase: 'extract', ms: 1200, serverId: 'vega', outcome: 'embed' });
  recordTiming({ phase: 'sniff', ms: 3000, serverId: 'vega', outcome: 'sniffed' });
  recordTiming({ phase: 'sniff', ms: 9000, serverId: 'vega', outcome: 'failed' });
  recordTiming({ phase: 'extract', ms: 400, serverId: 'flixeo', outcome: 'direct' });
  recordTiming({ phase: 'lookup', ms: 5200, outcome: 'ok', serverId: 'vega', title: 'Heat' });
  recordTiming({ phase: 'lookup', ms: 0, outcome: 'cache', title: 'Heat' });
  recordTiming({ phase: 'lookup', ms: 700, outcome: 'ok', background: true });
  const s = summarize();
  const vega = s.servers.find(x => x.serverId === 'vega')!;
  assert.equal(vega.extract.median, 800);
  assert.equal(vega.outcomes.embed, 2);
  assert.equal(vega.sniffed, 1);
  assert.equal(vega.sniffFailed, 1);
  assert.equal(s.lookups.stats.median, 5200);
  assert.equal(s.lookups.cache, 1);
  assert.equal(s.background.ok, 1);
  assert.match(formatTimingReport(s), /vega: median 0\.80s.*embed:2/);
});
