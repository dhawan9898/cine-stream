// The resolver serves picked servers, failovers and repeat visits from one saved record per title.
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }
};

const { VidLinkExtractor } = await import('../sources/vidlink.ts');
const { VidRockExtractor } = await import('../sources/vidrock.ts');
const { RivestreamExtractor } = await import('../sources/rivestream.ts');
const { MovyExtractor } = await import('../sources/movy.ts');
const { MovierulzExtractor } = await import('../sources/movierulz.ts');
const { FlixeoExtractor } = await import('../sources/flixeo.ts');
const { HDHub4UExtractor } = await import('../sources/hdhub4u.ts');
const { DesiCinemasExtractor } = await import('../sources/desicinemas.ts');
const { EinthusanExtractor } = await import('../sources/einthusan.ts');
const { IsaiminiExtractor } = await import('../sources/isaimini.ts');
const { resolveStream, forgetStream } = await import('./resolver.ts');
const { allStreamRecords, dropRecordsWithout, getStreamRecord, putStream, streamStoreReady } = await import('./streamStore.ts');

const ALL = [VidLinkExtractor, VidRockExtractor, RivestreamExtractor, MovyExtractor, MovierulzExtractor, FlixeoExtractor, HDHub4UExtractor, DesiCinemasExtractor, EinthusanExtractor, IsaiminiExtractor];
const asked: string[] = [];
const WORKS = ['vidlink', 'vidrock', 'rivestream'];
ALL.forEach(C => {
  (C.prototype as { extract: unknown }).extract = async function (this: { id: string; name: string }, p: { id: number }) {
    asked.push(this.id);
    return WORKS.includes(this.id) ? { url: `https://cdn.test/${this.id}/${p.id}/index.m3u8`, format: 'hls' as const, serverId: this.id, serverName: this.name } : null;
  };
});
await streamStoreReady;
const recordsOf = (id: number) => allStreamRecords().filter(r => (r.params as { id?: number } | undefined)?.id === id);

test('one lookup saves one record per title holding every server\'s link', async () => {
  const first = await resolveStream({ id: 901, type: 'movie', title: 'Film' }, { fresh: true });
  assert.ok(WORKS.includes(first.serverId!));
  const records = recordsOf(901);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].links?.map(l => l.stream.serverId).sort(), [...WORKS].sort());
  assert.ok((first.alternates ?? []).length >= 2, 'the other servers are the player\'s alternates');
});

test('picking a server, or the same title asked with other wording, is served from the record', async () => {
  asked.length = 0;
  for (const id of WORKS) assert.equal((await resolveStream({ id: 901, type: 'movie', title: 'Film', preferredServerId: id })).serverId, id);
  assert.ok((await resolveStream({ id: 901, type: 'movie', title: 'Film (1999)' })).url);
  assert.deepEqual(asked, [], 'no provider was asked again');
});

test('a failed server\'s link is forgotten alone: the other servers stay saved', async () => {
  const main = await resolveStream({ id: 901, type: 'movie', title: 'Film' });
  const other = WORKS.find(id => id !== main.serverId)!;
  forgetStream({ id: 901, type: 'movie' }, other);
  const links = getStreamRecord(recordsOf(901)[0].key)!.links!;
  assert.equal(links.find(l => l.stream.serverId === other)?.status, 'dead');
  assert.equal(links.filter(l => l.status === 'dead').length, 1);
  asked.length = 0;
  assert.equal((await resolveStream({ id: 901, type: 'movie' })).serverId, main.serverId, 'still served from the record');
  assert.deepEqual(asked, []);
  // The dead server picked explicitly: a new lookup, not the dead link.
  const again = await resolveStream({ id: 901, type: 'movie', preferredServerId: other });
  assert.equal(again.serverId, other);
  assert.ok(asked.length > 0);
});

test('records of an older format are dropped', () => {
  putStream('v1|movie|5|0|0|sub||Old|', { url: 'https://old.test/a.m3u8' });
  assert.ok(dropRecordsWithout('v16|') >= 1);
  assert.equal(getStreamRecord('v1|movie|5|0|0|sub||Old|'), undefined);
  assert.ok(recordsOf(901).length === 1, 'current ones kept');
});
