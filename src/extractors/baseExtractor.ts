// baseExtractor.ts - Base class providing HTTP helper functions for stream extractors
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { StreamExtractor, ExtractedStream } from './types.ts';

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
          connectTimeout: 10000,
          readTimeout: 10000
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
    const timeout = setTimeout(() => controller.abort(), 10000);
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

  abstract extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
  }): Promise<ExtractedStream | null>;
}
