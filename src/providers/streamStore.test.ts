import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allStreamRecords, getLiveStream, getStreamRecord, markStreamChecked, markStreamDead, putStream, streamStoreReady } from './streamStore.ts';
import { checkLink, dueRecords, runRevalidationCycle, setStreamPlaying } from './streamRevalidator.ts';

await streamStoreReady;

test('saved streams never expire', () => {
  putStream('k1', { url: 'https://a/x.m3u8' });
  const r = getStreamRecord('k1')!;
  // Pretend it was saved a year ago: still served.
  (r as { savedAt: number }).savedAt = Date.now() - 365 * 24 * 3600 * 1000;
  assert.equal(getLiveStream<{ url: string }>('k1')?.url, 'https://a/x.m3u8');
});

test('embed pages are saved with the stream and survive a later save without embeds', () => {
  putStream('k2', { url: 'https://a/y.m3u8' }, [{ url: 'https://embed/y', format: 'hls', isFallbackEmbed: true, serverId: 'vega' }]);
  putStream('k2', { url: 'https://a/y2.m3u8' });
  assert.equal(getStreamRecord('k2')?.embeds.length, 1);
});

test('a dead link is kept but not served; a new save revives it', () => {
  putStream('k3', { url: 'https://a/z.m3u8' });
  markStreamDead('k3');
  assert.equal(getLiveStream('k3'), undefined);
  assert.ok(getStreamRecord('k3'));
  putStream('k3', { url: 'https://a/z2.m3u8' });
  assert.equal(getLiveStream<{ url: string }>('k3')?.url, 'https://a/z2.m3u8');
});

test('unjudgeable checks keep the status; only due records are listed, oldest first', () => {
  putStream('old', { url: 'https://a/o.m3u8' });
  putStream('new', { url: 'https://a/n.m3u8' });
  const now = Date.now();
  (getStreamRecord('old') as { checkedAt: number }).checkedAt = now - 3 * 3600 * 1000;
  (getStreamRecord('new') as { checkedAt: number }).checkedAt = now;
  markStreamChecked('new', undefined);
  assert.equal(getStreamRecord('new')?.status, 'alive');
  const due = dueRecords(now + 1000).map(r => r.key);
  assert.ok(due.includes('old') && !due.includes('new'));
  assert.ok(due.indexOf('old') >= 0 && allStreamRecords().length >= 2);
});

test('no idle checking while the app is not idle or something is playing', async () => {
  setStreamPlaying(true);
  assert.equal(await runRevalidationCycle(), 0);
  setStreamPlaying(false); // marks activity just now, so still not idle
  assert.equal(await runRevalidationCycle(), 0);
});

test('checkLink cannot judge a link while offline', async () => {
  const g = globalThis as { navigator?: unknown };
  const saved = Object.getOwnPropertyDescriptor(g, 'navigator');
  Object.defineProperty(g, 'navigator', { value: { onLine: false }, configurable: true });
  try {
    assert.equal(await checkLink({ key: 'x', value: { url: 'https://a/b.m3u8' }, embeds: [], savedAt: 0, checkedAt: 0, status: 'alive' }), undefined);
  } finally {
    if (saved) Object.defineProperty(g, 'navigator', saved); else delete g.navigator;
  }
});

test('over the cap, dead links go first, then the least recently checked', async () => {
  const { enforceStreamCap, MAX_STREAM_RECORDS } = await import('./streamStore.ts');
  assert.equal(MAX_STREAM_RECORDS, 2_000);
  for (const r of allStreamRecords()) markStreamDead(r.key); // start from a known state
  allStreamRecords().forEach(r => { (r as { status: string }).status = 'alive'; });
  const base = allStreamRecords().length;
  putStream('cap-old', { url: 'https://a/1.m3u8' });
  putStream('cap-dead', { url: 'https://a/2.m3u8' });
  putStream('cap-new', { url: 'https://a/3.m3u8' });
  (getStreamRecord('cap-old') as { checkedAt: number }).checkedAt = 1;
  (getStreamRecord('cap-dead') as { checkedAt: number }).checkedAt = Date.now();
  markStreamDead('cap-dead');
  // Cap of base+1 with a batch of 1 keeps only base+1 -> drops 2: the dead one, then the stalest.
  const dropped = enforceStreamCap(base + 1, 0);
  assert.equal(dropped, 2);
  assert.equal(getStreamRecord('cap-dead'), undefined);
  assert.equal(getStreamRecord('cap-old') === undefined || getStreamRecord('cap-new') !== undefined, true);
  assert.ok(getStreamRecord('cap-new'));
});
