// webSniffer.ts - Turns an embed (iframe) page into a direct stream by loading it in a
// hidden native WebView and catching the real media request. Native Android only.
// The native side keeps a small pool of WebViews, so a lookup does not pay to build one,
// and a lookup that is no longer needed can be cancelled to free its WebView.
import { Capacitor } from '@capacitor/core';
import { ExoPlayerPlugin } from '../plugins/exoPlayerPlugin.ts';
import type { ExtractedStream } from './extractors/types.ts';
import { formatOf } from './extractors/streamDiscovery.ts';
import { recordTiming } from './streamTimings.ts';

let nextId = 0;

export async function sniffDirectStream(embed: ExtractedStream, timeoutMs = 15000, signal?: AbortSignal): Promise<ExtractedStream | null> {
  if (!Capacitor.isNativePlatform()) return null;
  if (signal?.aborted) return null;
  const id = `sniff-${Date.now().toString(36)}-${nextId++}`;
  const onAbort = () => { ExoPlayerPlugin.cancelSniff({ id }).catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await ExoPlayerPlugin.sniffStream({
      id,
      url: embed.url,
      referer: new URL(embed.url).origin + '/',
      timeoutMs
    });
    const t = res.timing;
    if (t && !res.cancelled) {
      const base = { serverId: embed.serverId };
      recordTiming({ ...base, phase: 'webview', ms: t.acquireMs, outcome: t.pooled ? 'pooled' : 'cold' });
      if (t.pageMs >= 0) recordTiming({ ...base, phase: 'page', ms: t.pageMs, outcome: 'ok' });
      else recordTiming({ ...base, phase: 'page', ms: t.totalMs, outcome: 'none' });
      if (t.streamMs >= 0) recordTiming({ ...base, phase: 'stream', ms: t.streamMs, outcome: 'ok' });
    }
    if (!res.found || !res.url) return null;
    return {
      url: res.url,
      format: formatOf(res.url),
      headers: res.headers && Object.keys(res.headers).length ? res.headers : { Referer: res.referer || new URL(embed.url).origin + '/' },
      serverId: embed.serverId,
      serverName: embed.serverName
    };
  } catch (err) {
    console.warn(`[WebSniffer] ${embed.serverId} sniff failed:`, err);
    return null;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
