// vidrockExtractor.ts - VidRock through its JSON API, as Kunai does it (MIT, github.com/KitsuneKode/kunai).
// GET vidrock.net/api/movie/<tmdb> | tv/<tmdb>/<s>/<e> answers { <lane>: { url: <AES-256-GCM, base64url(iv|ct)>, language, type } };
// each lane's url decrypts with a fixed key to an HLS master (or a JSON list of renditions).
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream, QualityVariant, SourceManifest } from './types.ts';
import { KUNAI_UA, base64UrlToBytes, firstSuccess, formatOf, qualityRank } from './kunaiCommon.ts';

const ORIGIN = 'https://vidrock.net';
const KEY_HEX = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f';
const IV_LEN = 12;
const MAX_LANES = 6;
let keyPromise: Promise<CryptoKey> | undefined;

function gcmKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey('raw', Uint8Array.from(KEY_HEX.match(/../g)!.map(h => parseInt(h, 16))), { name: 'AES-GCM' }, false, ['decrypt']);
  return keyPromise;
}

export async function decryptVidrockUrl(ciphertext: string): Promise<string> {
  const bytes = base64UrlToBytes(ciphertext);
  if (bytes.length < IV_LEN + 16) throw new Error('ciphertext too short');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, IV_LEN) }, await gcmKey(), bytes.slice(IV_LEN));
  return new TextDecoder().decode(plain);
}

interface Lane { url?: string | null; language?: string | null; type?: string }

export class VidRockExtractor extends BaseExtractor {
  id = 'vidrock';
  name = 'VidRock';
  mainUrl = ORIGIN;
  // Each request gets a different CDN lane; some serve placeholder images as segments.
  manifest = { idKind: 'tmdb', costHint: 'api', priorMs: 1800, linkTtlMs: 2 * 60 * 1000, deepProbe: true, trust: 'api' } satisfies SourceManifest;

  async extract(params: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number; signal?: AbortSignal }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1, signal } = params;
    const path = type === 'tv' ? `tv/${id}/${season}/${episode}` : `movie/${id}`;
    const headers = { Origin: this.mainUrl, Referer: `${this.mainUrl}/`, 'User-Agent': KUNAI_UA };
    const body = await this.httpGet(`${this.mainUrl}/api/${path}`, headers, { signal, timeoutMs: 5000 });
    const data = JSON.parse(body) as Record<string, Lane | undefined>;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    // Every lane is decrypted and probed at once; the first one that really plays wins.
    const lanes = Object.values(data).filter((l): l is Lane => Boolean(l?.url)).slice(0, MAX_LANES);
    return firstSuccess(lanes.map(async (lane): Promise<ExtractedStream | null> => {
      let url: string;
      try { url = await decryptVidrockUrl(lane.url!); } catch { return null; }
      if (!/^https?:/.test(url)) return null;
      let found: ExtractedStream | null = null;
      if (url.includes('/playlist/')) {
        // A JSON list of renditions: [{ url, resolution }]
        try {
          const list = JSON.parse(await this.httpGet(url, headers, { signal, timeoutMs: 4000 })) as { url?: string; resolution?: string }[];
          const qualities: QualityVariant[] = list.filter(i => i?.url).map(i => ({ quality: String(i.resolution ?? ''), url: String(i.url) }))
            .sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
          if (qualities.length === 0) return null;
          found = { url: qualities[0].url, quality: qualities[0].quality, format: formatOf(qualities[0].url), headers, qualities, serverId: this.id, serverName: this.name };
        } catch { return null; }
      } else {
        found = { url, format: formatOf(url, lane.type), headers, serverId: this.id, serverName: this.name };
      }
      return (await this.probe(found, signal)) ? found : null;
    }));
  }
}
