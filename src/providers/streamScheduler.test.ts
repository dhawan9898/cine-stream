import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyedPriorityQueue } from './priorityQueue.ts';
import { Priority, StreamScheduler } from './streamScheduler.ts';

const drain = <T>(q: KeyedPriorityQueue<T>) => { const out: string[] = []; for (let e = q.pop(); e; e = q.pop()) out.push(e.key); return out; };

test('queue pops by priority, then FIFO', () => {
  const q = new KeyedPriorityQueue<number>();
  q.push('c', 0, 5); q.push('a', 0, 1); q.push('b', 0, 1); q.push('d', 0, 3);
  assert.deepEqual(drain(q), ['a', 'b', 'd', 'c']);
});

test('queue tie order can be LIFO (newest first)', () => {
  const q = new KeyedPriorityQueue<number>(() => 'lifo');
  q.push('a', 0, 4); q.push('b', 0, 4); q.push('c', 0, 4);
  assert.deepEqual(drain(q), ['c', 'b', 'a']);
});

test('duplicate keys are ignored, better priority promotes', () => {
  const q = new KeyedPriorityQueue<number>();
  assert.equal(q.push('x', 1, 5), 'added');
  assert.equal(q.push('x', 2, 6), 'duplicate');
  q.push('y', 3, 4);
  assert.equal(q.push('x', 4, 1), 'promoted');
  assert.equal(q.size, 2);
  assert.equal(q.pop()?.payload, 4);
  assert.deepEqual(drain(q), ['y']);
});

test('cancel and trim drop the right entries', () => {
  const q = new KeyedPriorityQueue<number>();
  q.push('a', 0, 1); q.push('b', 0, 5); q.push('c', 0, 3); q.push('d', 0, 6);
  q.cancel('c');
  assert.equal(q.trim(2), 1); // drops the worst: d
  assert.deepEqual(drain(q), ['a', 'b']);
});

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

test('scheduler runs highest priority first, limited by concurrency', async () => {
  const order: string[] = [];
  const gates = new Map<string, () => void>();
  const s = new StreamScheduler<string>(p => new Promise<void>(res => { order.push(p); gates.set(p, res); }), { concurrency: 1 });
  s.enqueue('poster', 'poster', Priority.POSTER);
  s.enqueue('detail', 'detail', Priority.DETAIL);
  s.enqueue('next', 'next', Priority.NEXT_EPISODE);
  await tick();
  assert.deepEqual(order, ['next']);
  gates.get('next')!(); await tick();
  gates.get('detail')!(); await tick();
  gates.get('poster')!(); await tick();
  assert.deepEqual(order, ['next', 'detail', 'poster']);
});

test('a queued job is promoted when asked again with a better priority', async () => {
  const order: string[] = [];
  let release!: () => void;
  const s = new StreamScheduler<string>(p => { order.push(p); return new Promise<void>(r => { if (p === 'first') release = r; else r(); }); }, { concurrency: 1 });
  s.enqueue('first', 'first', Priority.RAIL);
  await tick();
  s.enqueue('a', 'a', Priority.RAIL);
  s.enqueue('b', 'b', Priority.POSTER);
  assert.equal(s.enqueue('b', 'b', Priority.FOCUS), 'promoted');
  release(); await tick(20);
  assert.deepEqual(order, ['first', 'b', 'a']);
});

test('background jobs wait while an urgent lookup runs', async () => {
  const ran: string[] = [];
  const s = new StreamScheduler<string>(async p => { ran.push(p); }, { concurrency: 2 });
  let finish!: () => void;
  s.trackUrgent(new Promise<void>(r => { finish = r; }));
  s.enqueue('bg', 'bg', Priority.RAIL);
  s.enqueue('next', 'next', Priority.NEXT_EPISODE);
  await tick(20);
  assert.deepEqual(ran, ['next']); // the background job is held back
  finish(); await tick(20);
  assert.deepEqual(ran, ['next', 'bg']);
});

test('stale low-priority jobs are dropped, queue is capped', async () => {
  let t = 0;
  const ran: string[] = [];
  const s = new StreamScheduler<string>(async p => { ran.push(p); }, { concurrency: 1, staleAfterMs: 100, now: () => t, maxQueued: 2 });
  let finish!: () => void;
  s.trackUrgent(new Promise<void>(r => { finish = r; }));
  s.enqueue('old', 'old', Priority.POSTER);
  s.enqueue('mid', 'mid', Priority.RAIL);
  s.enqueue('new', 'new', Priority.FOCUS); // over the cap: the worst (old) is dropped
  assert.equal(s.queued, 2);
  t = 1000; // everything left is now stale, except priority < RAIL
  finish(); await tick(20);
  assert.deepEqual(ran, ['new']);
});

test('the queue holds up to 100 jobs by default', async () => {
  const s = new StreamScheduler<string>(async () => undefined, { concurrency: 1 });
  s.trackUrgent(new Promise<void>(() => undefined)); // keep everything queued
  for (let i = 0; i < 150; i++) s.enqueue(`k${i}`, `k${i}`, Priority.POSTER);
  assert.equal(s.queued, 100);
});
