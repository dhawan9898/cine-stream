// apiExtractor.ts - A provider that is a plain JSON API, described by config instead of code.
//
// For a source the user is entitled to use (their own server, a catalog they hold a key for): the
// config gives a URL template per kind of title, any request headers, and the dot path of the stream
// URL in the answer. The extractor fetches it and returns a DIRECT stream - never an embed page.
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';
import { safeUrl, type ApiProviderSpec } from '../providerConfig.ts';

/** Reads `a.b.0.c` out of parsed JSON. */
export function readPath(data: unknown, path: string): unknown {
  let node: unknown = data;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

export class ApiExtractor extends BaseExtractor {
  id: string;
  name: string;
  mainUrl: string;
  private spec: ApiProviderSpec;

  constructor(spec: ApiProviderSpec) {
    super();
    this.spec = spec;
    this.id = spec.id;
    this.name = spec.name;
    this.mainUrl = new URL(spec.movieUrl.replace(/\{[a-zA-Z]+\}/g, '1')).origin;
  }

  private urlFor(p: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number }): string | undefined {
    const template = p.type === 'tv' ? this.spec.tvUrl : this.spec.movieUrl;
    if (!template) return undefined;
    return template
      .replace('{tmdbId}', String(p.id))
      .replace('{season}', String(p.season ?? 1))
      .replace('{episode}', String(p.episode ?? 1));
  }

  async extract(params: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number; signal?: AbortSignal }): Promise<ExtractedStream | null> {
    if (params.signal?.aborted) return null;
    const url = this.urlFor(params);
    if (!url) return null;
    try {
      const body = await this.httpGet(url, { Accept: 'application/json', ...(this.spec.headers ?? {}) }, { signal: params.signal });
      const stream = readPath(JSON.parse(body), this.spec.streamPath);
      const streamUrl = safeUrl(typeof stream === 'string' ? stream : undefined);
      if (!streamUrl) return null;
      return {
        url: streamUrl,
        format: this.spec.format ?? (/\.mpd(\?|$)/i.test(streamUrl) ? 'dash' : /\.mp4(\?|$)/i.test(streamUrl) ? 'mp4' : 'hls'),
        headers: this.spec.streamHeaders,
        serverId: this.id,
        serverName: this.name
      };
    } catch {
      return null;
    }
  }
}
