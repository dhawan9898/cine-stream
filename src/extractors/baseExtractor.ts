// baseExtractor.ts - Base class providing HTTP helper functions for stream extractors
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { StreamExtractor, ExtractedStream, ExtractorSubtitle } from './types.ts';
import { discover, pickBest, type FoundStream } from './streamDiscovery.ts';

export abstract class BaseExtractor implements StreamExtractor {
  abstract id: string;
  abstract name: string;
  abstract mainUrl: string;

  protected defaultUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/122.0.0.0 Safari/537.36';

  protected async httpGet(url: string, headers: Record<string, string> = {}): Promise<string> {
    const mergedHeaders = {
      'User-Agent': this.defaultUserAgent,
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers
    };

    if (Capacitor.isNativePlatform()) {
      try {
        const response = await CapacitorHttp.get({
          url,
          headers: mergedHeaders,
          connectTimeout: 3000,
          readTimeout: 3000
        });
        if (response.status >= 200 && response.status < 300) {
          return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        }
      } catch (err) {
        console.warn(`[${this.id}] CapacitorHttp GET failed for ${url}:`, err);
      }
    }

    // Standard web fetch fallback
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(url, {
        headers: mergedHeaders,
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  protected async resolveFromPage(
    startUrl: string,
    opts: { referer?: string; maxDepth?: number; maxPages?: number } = {}
  ): Promise<ExtractedStream | null> {
    const maxDepth = opts.maxDepth ?? 2;
    const maxPages = opts.maxPages ?? 4;
    const visited = new Set<string>();
    const subtitles = new Map<string, ExtractorSubtitle>();
    let queue: Array<{ url: string; referer: string }> = [{ url: startUrl, referer: opts.referer ?? this.mainUrl + '/' }];
    const found: Array<FoundStream & { pageUrl: string }> = [];

    for (let depth = 0; depth <= maxDepth && queue.length > 0 && visited.size < maxPages; depth++) {
      const next: Array<{ url: string; referer: string }> = [];
      for (const page of queue) {
        if (visited.has(page.url) || visited.size >= maxPages) continue;
        visited.add(page.url);
        let body: string;
        try {
          body = await this.httpGet(page.url, { Referer: page.referer, Accept: '*/*' });
        } catch {
          continue;
        }
        const result = discover(body, page.url);
        result.streams.forEach(s => found.push({ ...s, pageUrl: page.url }));
        result.subtitles.forEach(s => subtitles.set(s.url, s));
        result.pages.forEach(p => { if (!visited.has(p)) next.push({ url: p, referer: page.url }); });
      }
      if (found.length > 0) break;
      queue = next;
    }

    const best = pickBest(found);
    if (!best) return null;
    const origin = new URL(found.find(f => f.url === best.url)!.pageUrl).origin;
    return {
      url: best.url,
      format: best.format,
      quality: best.quality,
      headers: {
        Referer: origin + '/',
        Origin: origin,
        'User-Agent': this.defaultUserAgent
      },
      subtitles: [...subtitles.values()]
    };
  }

  abstract extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null>;
}
