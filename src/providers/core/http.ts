// http.ts - The one way the provider layer talks to the network.
//
// Every request goes through here: one transport per platform (CapacitorHttp on Android, so sites that
// refuse CORS still answer; fetch on the web), one per-host budget (hostLimiter.ts: token bucket, a 429
// closes the host for its Retry-After), one timeout and cancellation rule.
//
// A GET may also be memoised for a few seconds (`memoMs`): a provider checks that a stream's playlist
// answers, and the registry then reads the same playlist for its length, quality and languages - with
// the memo that is one network fetch, not two. Concurrent memoised GETs of one address share a single
// request; a caller that gives up only stops waiting, the shared request finishes for the others.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { hostLimiter, isBackground, retryAfterMs } from './hostLimiter.ts';

export const DEFAULT_TIMEOUT_MS = 5000;

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/124.0.0.0 Safari/537.36';

/** A non-2xx answer. The message keeps the "HTTP <status>" form callers match on (e.g. /\b429\b/). */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface RequestOptions {
  /** Counts as background work (yields to the user's own requests) even without a marked signal. */
  background?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** GET only: reuse the answer for this long (and share a request already running). */
  memoMs?: number;
  /** Send only `headers` (no browser User-Agent / language): a cross-origin call on the web that
   *  must not trigger a CORS preflight. */
  bare?: boolean;
}

type Body = { kind: 'text'; value: string } | { kind: 'bytes'; value: Uint8Array };

interface Raw { status: number; headers: Record<string, string>; body: Body }

const aborted = () => Object.assign(new Error('Request aborted'), { name: 'AbortError' });

function headerOf(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find(k => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  const c = new AbortController();
  const abort = () => c.abort();
  if (signal.aborted) c.abort();
  signal.addEventListener('abort', abort, { once: true });
  timeout.addEventListener('abort', abort, { once: true });
  return c.signal;
}

async function transport(method: 'GET' | 'POST', url: string, headers: Record<string, string>, as: Body['kind'], timeoutMs: number, signal: AbortSignal | undefined, body?: unknown): Promise<Raw> {
  if (Capacitor.isNativePlatform()) {
    const call = { url, headers, connectTimeout: timeoutMs, readTimeout: timeoutMs, ...(as === 'bytes' ? { responseType: 'arraybuffer' as const } : {}) };
    const r = method === 'POST' ? await CapacitorHttp.post({ ...call, data: body }) : await CapacitorHttp.get(call);
    const data = r.data as unknown;
    const value: Body = as === 'bytes'
      ? { kind: 'bytes', value: typeof data === 'string' ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : new Uint8Array(0) }
      : { kind: 'text', value: typeof data === 'string' ? data : JSON.stringify(data) };
    return { status: r.status, headers: r.headers ?? {}, body: value };
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: withTimeout(signal, timeoutMs)
  });
  const out: Record<string, string> = {};
  res.headers?.forEach?.((v, k) => { out[k] = v; });
  return {
    status: res.status,
    headers: out,
    body: as === 'bytes' ? { kind: 'bytes', value: new Uint8Array(await res.arrayBuffer()) } : { kind: 'text', value: await res.text() }
  };
}

async function send(method: 'GET' | 'POST', url: string, as: Body['kind'], opts: RequestOptions, body?: unknown): Promise<Body> {
  if (opts.signal?.aborted) throw aborted();
  const headers = opts.bare ? { ...opts.headers } : {
    'User-Agent': BROWSER_UA,
    ...(method === 'GET' && as === 'text' ? { 'Accept-Language': 'en-US,en;q=0.9' } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {}),
    ...opts.headers
  };
  // One budget per host for every provider; throws at once when the host is closed or busy.
  await hostLimiter.acquire(url, { signal: opts.signal, background: opts.background ?? isBackground(opts.signal) });
  const r = await transport(method, url, headers, as, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal, body);
  if (r.status === 429) hostLimiter.penalize(url, retryAfterMs(headerOf(r.headers, 'retry-after')));
  if (r.status < 200 || r.status >= 300) throw new HttpError(r.status);
  return r.body;
}

// ---- memo -----------------------------------------------------------------------------

const MEMO_MAX = 64;
const memo = new Map<string, { until: number; value: Promise<string> }>();

function memoKey(url: string, headers: Record<string, string> | undefined): string {
  // Accept / UA / language do not change a playlist; anything that could (Referer, tokens) is in the key.
  const relevant = Object.entries(headers ?? {})
    .filter(([k]) => !/^(accept|accept-language|user-agent)$/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  return `${url}\n${JSON.stringify(relevant)}`;
}

function race<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      v => { signal.removeEventListener('abort', onAbort); resolve(v); },
      e => { signal.removeEventListener('abort', onAbort); reject(e); }
    );
  });
}

function memoText(url: string, opts: RequestOptions & { memoMs: number }): Promise<string> {
  const key = memoKey(url, opts.headers);
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && hit.until > now) return race(hit.value, opts.signal);
  // Shared by everyone who asks meanwhile, so it is not tied to the first caller's signal; it keeps
  // the background flag (a speculative lookup still yields to the user's own requests).
  const shared = send('GET', url, 'text', { ...opts, signal: undefined, background: isBackground(opts.signal) }).then(b => b.value as string);
  memo.set(key, { until: now + opts.memoMs, value: shared });
  shared.catch(() => { if (memo.get(key)?.value === shared) memo.delete(key); });
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
  return race(shared, opts.signal);
}

/** A 429, or a request refused because its host is closed / out of budget after one. */
export function isRateLimited(e: unknown): boolean {
  return (e instanceof HttpError && e.status === 429) || (e instanceof Error && e.name === 'RateLimitedError');
}

/** Forgets memoised answers (Settings > Clear Cache, tests). */
export function clearHttpMemo(): void {
  memo.clear();
}

// ---- API ------------------------------------------------------------------------------

export const http = {
  /** GET as text. Throws HttpError on a non-2xx answer, RateLimitedError when the host is closed. */
  text(url: string, opts: RequestOptions = {}): Promise<string> {
    if (opts.memoMs && opts.memoMs > 0) return memoText(url, opts as RequestOptions & { memoMs: number });
    return send('GET', url, 'text', opts).then(b => b.value as string);
  },
  /** GET and parse JSON. */
  async json<T>(url: string, opts: RequestOptions = {}): Promise<T> {
    return JSON.parse(await http.text(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } })) as T;
  },
  /** GET as bytes (e.g. the first bytes of a segment, with a Range header). */
  bytes(url: string, opts: RequestOptions = {}): Promise<Uint8Array> {
    return send('GET', url, 'bytes', opts).then(b => b.value as Uint8Array);
  },
  /** POST a JSON body; the answer as text. */
  postJson(url: string, body: unknown, opts: RequestOptions = {}): Promise<string> {
    return send('POST', url, 'text', opts, body).then(b => b.value as string);
  }
};
