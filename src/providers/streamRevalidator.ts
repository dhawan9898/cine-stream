// streamRevalidator.ts - Keeps the saved links honest while the app is idle.
//
// When the user has not touched the app for a while (and nothing is playing),
// saved links are re-checked one at a time, least recently checked first. A link
// that no longer answers is flagged dead and queued for a fresh lookup at the
// lowest priority. Checking stops the moment the user does something.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { allStreamRecords, markStreamChecked, markStreamDead, streamStoreReady, type StreamRecord } from './streamStore.ts';

/** A link is re-checked when it has not been checked for this long. */
const RECHECK_AFTER_MS = 30 * 60 * 1000;
/** The user must have been inactive this long before any checking starts. */
const IDLE_AFTER_MS = 20 * 1000;
/** Pause between two checks, and between idle cycles. */
const CHECK_GAP_MS = 1500;
const CYCLE_MS = 60 * 1000;
const MAX_PER_CYCLE = 12;
const CHECK_TIMEOUT_MS = 4000;

export type LinkCheck = boolean | undefined;

let playing = false;
let lastActivity = Date.now();
let started = false;
let onDead: ((record: StreamRecord) => void) | undefined;

/** Called by the app while the player is open: no checking during playback. */
export function setStreamPlaying(active: boolean): void {
  playing = active;
  if (!active) lastActivity = Date.now();
}

export function isStreamPlaying(): boolean {
  return playing;
}

/**
 * Whether a link still answers. `true`/`false` when it can be judged, `undefined`
 * when it cannot (offline, or a browser that hides the response from the page).
 */
export async function checkLink(record: StreamRecord): Promise<LinkCheck> {
  const { url, headers } = record.value as { url: string; headers?: Record<string, string> };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined;
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({
        url,
        headers: { ...(headers ?? {}), Range: 'bytes=0-1023' },
        connectTimeout: CHECK_TIMEOUT_MS,
        readTimeout: CHECK_TIMEOUT_MS
      });
      if (res.status >= 200 && res.status < 300) return true;
      // Signed links answer 401/403/404/410 once they expire.
      return res.status >= 400 && res.status < 500 ? false : undefined;
    }
    // A page cannot read cross-origin responses: only a CORS-enabled host can be judged.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: ctl.signal });
      if (res.ok) return true;
      return res.status >= 400 && res.status < 500 ? false : undefined;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return undefined;
  }
}

const isIdle = () =>
  !playing &&
  (typeof document === 'undefined' || document.visibilityState === 'visible') &&
  Date.now() - lastActivity >= IDLE_AFTER_MS;

/** The records due for a check, least recently checked first. */
export function dueRecords(now = Date.now()): StreamRecord[] {
  return allStreamRecords()
    .filter(r => r.value.url && now - r.checkedAt >= RECHECK_AFTER_MS)
    .sort((a, b) => a.checkedAt - b.checkedAt);
}

/** Runs one idle cycle. Returns how many links were checked. */
export async function runRevalidationCycle(limit = MAX_PER_CYCLE): Promise<number> {
  await streamStoreReady;
  let checked = 0;
  for (const record of dueRecords().slice(0, limit)) {
    if (!isIdle()) break;
    const alive = await checkLink(record);
    if (alive === false) {
      markStreamDead(record.key);
      onDead?.(record);
    } else {
      markStreamChecked(record.key, alive);
    }
    checked++;
    await new Promise(r => setTimeout(r, CHECK_GAP_MS));
  }
  return checked;
}

/**
 * Starts the idle loop (once). `handleDead` is told about every link that stopped
 * working, to queue a fresh lookup for it.
 */
export function startStreamRevalidator(handleDead: (record: StreamRecord) => void): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  onDead = handleDead;
  const touch = () => { lastActivity = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel']) {
    window.addEventListener(ev, touch, { passive: true, capture: true });
  }
  const loop = async () => {
    try {
      if (isIdle()) await runRevalidationCycle();
    } catch { /* never let a check break the app */ }
    setTimeout(loop, CYCLE_MS);
  };
  setTimeout(loop, IDLE_AFTER_MS);
}
