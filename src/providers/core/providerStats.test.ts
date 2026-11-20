import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderStats } from './providerStats.ts';

const clock = () => { let t = 1_000_000; return { now: () => t, tick: (ms: number) => { t += ms; } }; };

test('breaker opens after repeated failures, then lets exactly one probe through', () => {
  const c = clock();
  const s = new ProviderStats({ now: c.now, store: undefined, failsToOpen: 3, baseBackoffMs: 30_000 });
  for (let i = 0; i < 3; i++) s.record('a', false);
  assert.equal(s.state('a'), 'open');
  assert.equal(s.tryAcquire('a'), false);
  c.tick(30_001);
  assert.equal(s.state('a'), 'half-open');
  assert.equal(s.tryAcquire('a'), true);   // the probe
  assert.equal(s.tryAcquire('a'), false);  // others wait for its result
  s.record('a', true, 800);
  assert.equal(s.state('a'), 'closed');
  assert.equal(s.tryAcquire('a'), true);
});

test('a failed probe doubles the backoff, capped', () => {
  const c = clock();
  const s = new ProviderStats({ now: c.now, failsToOpen: 1, baseBackoffMs: 1000, maxBackoffMs: 3000 });
  s.record('a', false);                      // open, 1s
  c.tick(1001); assert.equal(s.tryAcquire('a'), true); s.record('a', false); // probe failed -> 2s
  c.tick(1500); assert.equal(s.state('a'), 'open');
  c.tick(600);  assert.equal(s.state('a'), 'half-open');
  assert.equal(s.tryAcquire('a'), true); s.record('a', false);               // -> 3s (cap)
  c.tick(2900); assert.equal(s.state('a'), 'open');
  c.tick(200);  assert.equal(s.state('a'), 'half-open');
});

test('ranking prefers fast and reliable providers; unknown ones sit in the middle', () => {
  const s = new ProviderStats({});
  for (let i = 0; i < 5; i++) { s.record('fast', true, 600); s.record('slow', true, 6000); s.record('flaky', i === 0, 700); }
  const order = s.rank([{ id: 'slow' }, { id: 'unknown' }, { id: 'flaky' }, { id: 'fast' }]).map(x => x.id);
  assert.equal(order[0], 'fast');
  assert.equal(order.indexOf('slow') > order.indexOf('fast'), true);
  assert.equal(order.indexOf('flaky') > order.indexOf('unknown'), true);
});

test('rank bias lets a title-specific preference (regional) nudge the order', () => {
  const s = new ProviderStats({});
  s.record('a', true, 500); s.record('b', true, 900);
  assert.equal(s.rank([{ id: 'a' }, { id: 'b' }])[0].id, 'a');
  assert.equal(s.rank([{ id: 'a' }, { id: 'b' }], id => (id === 'b' ? 5000 : 0))[0].id, 'b');
});

test('hedge delay follows the typical time, within bounds', () => {
  const s = new ProviderStats({});
  for (let i = 0; i < 4; i++) { s.record('fast', true, 100); s.record('slow', true, 9000); s.record('flaky', i % 2 === 0, 500); }
  assert.equal(s.hedgeDelayMs('fast'), 400);
  assert.equal(s.hedgeDelayMs('slow'), 2500);
  assert.equal(s.hedgeDelayMs('flaky'), 0);   // not reliable enough to wait for
  assert.equal(s.hedgeDelayMs('unknown'), 0); // nothing known: start the alternative at once
});

test('state survives a restart; an in-flight probe does not', () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  const a = new ProviderStats({ storageKey: 'k', store });
  a.record('x', true, 700);
  const b = new ProviderStats({ storageKey: 'k', store });
  assert.equal(b.snapshot().x.samples, 1);
  assert.ok(b.expectedMs('x') < 4000);
});
