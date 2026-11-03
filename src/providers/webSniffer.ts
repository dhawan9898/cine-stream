// webSniffer.ts - Turns an embed (iframe) page into a direct stream by loading it in a
// hidden native WebView and catching the real media request. Native Android only.
import { Capacitor } from '@capacitor/core';
import { ExoPlayerPlugin } from '../plugins/exoPlayerPlugin.ts';
import type { ExtractedStream } from './extractors/types.ts';
import { formatOf } from './extractors/streamDiscovery.ts';

export async function sniffDirectStream(embed: ExtractedStream, timeoutMs = 15000): Promise<ExtractedStream | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const res = await ExoPlayerPlugin.sniffStream({
      url: embed.url,
      referer: new URL(embed.url).origin + '/',
      timeoutMs
    });
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
  }
}
