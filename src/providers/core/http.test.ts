import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, clearHttpMemo, http, isRateLimited } from './http.ts';
import { hostLimiter } from './hostLimiter.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; clearHttpMemo(); });

function fakeFetch(answer: (url: string, init?: RequestInit) => { status?: number; body?: string; headers?: Record<string, string> }, delayMs = 0) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    const a = answer(String(url), init);
    return new Response(a.body ?? '', { status: a.status ?? 200, headers: a.headers });
  }) as typeof fetch;
  return calls;
}

test('a memoised playlist is fetched once for a probe and the check that follows', async () => {
  const calls = fakeFetch(() => ({ body: '#EXTM3U' }));
  const headers = { Referer: 'https://a.test/' };
  assert.equal(await http.text('https://cdn1.test/a.m3u8', { headers: { ...headers, Accept: '*/*' }, memoMs: 5000 }), '#EXTM3U');
  assert.equal(await http.text('https://cdn1.test/a.m3u8', { headers, memoMs: 5000 }), '#EXTM3U');
  assert.equal(calls.length, 1, 'Accept does not change the memo key');
  await http.text('https://cdn1.test/a.m3u8', { headers: { Referer: 'https://b.test/' }, memoMs: 5000 });
  assert.equal(calls.length, 2, 'a different Referer is another request');
  await http.text('https://cdn1.test/a.m3u8', { headers });
  assert.equal(calls.length, 3, 'without memoMs nothing is reused');
});

test('concurrent memoised GETs share one request; a caller that leaves does not cancel it for the others', async () => {
  const calls = fakeFetch(() => ({ body: 'ok' }), 30);
  const ctl = new AbortController();
  const leaving = http.text('https://cdn2.test/p.m3u8', { memoMs: 5000, signal: ctl.signal });
  const staying = http.text('https://cdn2.test/p.m3u8', { memoMs: 5000 });
  ctl.abort();
  await assert.rejects(leaving, /aborted/);
  assert.equal(await staying, 'ok');
  assert.equal(calls.length, 1);
});

test('a failed memoised request is not remembered', async () => {
  let n = 0;
  fakeFetch(() => (++n === 1 ? { status: 503 } : { body: 'second' }));
  await assert.rejects(http.text('https://cdn3.test/x', { memoMs: 5000 }), (e: unknown) => e instanceof HttpError && e.status === 503);
  assert.equal(await http.text('https://cdn3.test/x', { memoMs: 5000 }), 'second');
});

test('a 429 closes the host: the next request fails at once without reaching the network', async () => {
  const calls = fakeFetch(() => ({ status: 429, headers: { 'retry-after': '30' } }));
  await assert.rejects(http.text('https://busy.test/a'), (e: unknown) => isRateLimited(e));
  assert.ok(hostLimiter.isClosed('https://busy.test/b'));
  await assert.rejects(http.text('https://busy.test/b'), (e: unknown) => isRateLimited(e));
  assert.equal(calls.length, 1);
});

test('bare requests send only the given headers; normal ones look like a browser', async () => {
  const calls = fakeFetch(() => ({ body: '{"a":1}' }));
  assert.deepEqual(await http.json('https://api4.test/j', { bare: true, headers: {} }), { a: 1 });
  assert.deepEqual(Object.keys(calls[0].headers), ['Accept']);
  await http.text('https://api4.test/t');
  assert.ok(calls[1].headers['User-Agent']?.includes('Mozilla'));
});
