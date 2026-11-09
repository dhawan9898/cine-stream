// baseExtractor.ts - Base class providing HTTP helper functions for stream extractors
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { StreamExtractor, ExtractedStream, ExtractorSubtitle } from './types.ts';
import { discover, pickBest, type FoundStream } from './streamDiscovery.ts';

// Fast per-request limit for sub-second provider resolution
const DEFAULT_HTTP_TIMEOUT_MS = 3500;

export abstract class BaseExtractor implements StreamExtractor {
  abstract id: string;
  abstract name: string;
  abstract mainUrl: string;

  protected defaultUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/124.0.0.0 Safari/537.36';

  protected async httpGet(
    url: string,
    headers: Record<string, string> = {},
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<string> {
    if (options.signal?.aborted) {
      throw new Error('Request aborted');
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const mergedHeaders = {
      'User-Agent': this.defaultUserAgent,
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers
    };

    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.get({
        url,
        headers: mergedHeaders,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs
      });
      if (response.status >= 200 && response.status < 300) {
        return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      }
      throw new Error(`HTTP ${response.status}`);
    }

    // Web: fetch with AbortSignal combined with timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const onExternalAbort = () => controller.abort();
    if (options.signal) {
      options.signal.addEventListener('abort', onExternalAbort);
    }

    try {
      const res = await fetch(url, {
        headers: mergedHeaders,
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  protected async resolveFromPage(
    startUrl: string,
    opts: { referer?: string; maxDepth?: number; maxPages?: number; signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<ExtractedStream | null> {
    if (opts.signal?.aborted) return null;
    const maxDepth = opts.maxDepth ?? 2;
    const maxPages = opts.maxPages ?? 4;
    const visited = new Set<string>();
    const subtitles = new Map<string, ExtractorSubtitle>();
    let queue: Array<{ url: string; referer: string }> = [{ url: startUrl, referer: opts.referer ?? this.mainUrl + '/' }];
    const found: Array<FoundStream & { pageUrl: string }> = [];

    for (let depth = 0; depth <= maxDepth && queue.length > 0 && visited.size < maxPages; depth++) {
      if (opts.signal?.aborted) break;
      const next: Array<{ url: string; referer: string }> = [];
      const batch = queue.filter(page => !visited.has(page.url)).slice(0, maxPages - visited.size);
      batch.forEach(page => visited.add(page.url));
      const bodies = await Promise.all(batch.map(async page => {
        try {
          return { page, body: await this.httpGet(page.url, { Referer: page.referer, Accept: '*/*' }, { signal: opts.signal, timeoutMs: opts.timeoutMs }) };
        } catch {
          return null;
        }
      }));
      for (const item of bodies) {
        if (!item) continue;
        const result = discover(item.body, item.page.url);
        result.streams.forEach(s => found.push({ ...s, pageUrl: item.page.url }));
        result.subtitles.forEach(s => subtitles.set(s.url, s));
        result.pages.forEach(p => { if (!visited.has(p)) next.push({ url: p, referer: item.page.url }); });
      }
      if (found.length > 0) break;
      queue = next;
    }

    const best = pickBest(found);
    if (!best) return null;
    const pageObj = found.find(f => f.url === best.url);
    const origin = pageObj ? new URL(pageObj.pageUrl).origin : new URL(this.mainUrl).origin;
    return {
      url: best.url,
      format: best.format,
      quality: best.quality,
      headers: {
        Referer: origin + '/',
        Origin: origin,
        'User-Agent': this.defaultUserAgent
      },
      subtitles: [...subtitles.values()],
      serverId: this.id,
      serverName: this.name
    };
  }

  abstract extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<ExtractedStream | null>;
}
