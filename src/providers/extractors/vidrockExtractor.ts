// vidrockExtractor.ts - VidRock through its JSON API, as Kunai does it (MIT, github.com/KitsuneKode/kunai).
// GET vidrock.net/api/movie/<tmdb> | tv/<tmdb>/<s>/<e> answers { <lane>: { url: <AES-256-GCM, base64url(iv|ct)>, language, type } };
// each lane's url decrypts with a fixed key to an HLS master (or a JSON list of renditions).
import { BaseExtractor } from './baseExtractor.ts';
import type { AudioVariant, ExtractedStream, QualityVariant, SourceManifest, ExtractParams } from './types.ts';
import { KUNAI_UA, base64UrlToBytes, firstSuccess, formatOf, qualityRank } from './kunaiCommon.ts';
import { LANGUAGE_NAMES } from './variantDiscovery.ts';

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
  manifest = { idKind: 'tmdb', costHint: 'api', priorMs: 800, linkTtlMs: 2 * 60 * 1000, deepProbe: true, trust: 'api' } satisfies SourceManifest;

  async extract(params: ExtractParams): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1, language, signal } = params;
    const path = type === 'tv' ? `tv/${id}/${season}/${episode}` : `movie/${id}`;
    const headers = { Origin: this.mainUrl, Referer: `${this.mainUrl}/`, 'User-Agent': KUNAI_UA };
    const body = await this.httpGet(`${this.mainUrl}/api/${path}`, headers, { signal, timeoutMs: 5000 });
    const data = JSON.parse(body) as Record<string, Lane | undefined>;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const rawLanes = Object.values(data).filter((l): l is Lane => Boolean(l?.url));
    const decrypted: Array<{ lane: Lane; url: string }> = [];
    for (const l of rawLanes) {
      try {
        const u = await decryptVidrockUrl(l.url!);
        // Discard short preview clips so full movies never get truncated to 10 minutes
        if (/^https?:/.test(u) && !/preview|_preview|preview\.m3u8|_trailer|trailer\.m3u8/i.test(u)) {
          decrypted.push({ lane: l, url: u });
        }
      } catch {
        // ignore decryption failures
      }
    }

    if (decrypted.length === 0) return null;

    // Lanes come in several languages (Interstellar: two English, two Tamil). Racing them all and
    // playing whichever answered first made the language a coin toss. Each language is resolved on
    // its own: the title's language plays, the others are offered under Audio.
    const nameOf = (lane: Lane) => {
      const l = (lane.language ?? '').trim();
      return l ? l[0].toUpperCase() + l.slice(1).toLowerCase() : '';
    };
    const wantedName = LANGUAGE_NAMES[(language || '').toLowerCase().split('-')[0]] ?? '';
    const byLanguage = new Map<string, Array<{ lane: Lane; url: string }>>();
    for (const d of decrypted.slice(0, MAX_LANES)) {
      const name = nameOf(d.lane);
      byLanguage.set(name, [...(byLanguage.get(name) ?? []), d]);
    }

    const resolveLane = async ({ lane, url }: { lane: Lane; url: string }): Promise<ExtractedStream | null> => {
      let found: ExtractedStream | null = null;
      if (url.includes('/playlist/')) {
        // A JSON list of renditions: [{ url, resolution }]
        try {
          const list = JSON.parse(await this.httpGet(url, headers, { signal, timeoutMs: 4000 })) as { url?: string; resolution?: string }[];
          const qualities: QualityVariant[] = list
            .filter(i => i?.url && !/preview|_preview/i.test(i.url))
            .map(i => ({ quality: String(i.resolution ?? ''), url: String(i.url) }))
            .sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
          if (qualities.length === 0) return null;
          found = { url: qualities[0].url, quality: qualities[0].quality, format: formatOf(qualities[0].url), headers, qualities, serverId: this.id, serverName: this.name };
        } catch { return null; }
      } else {
        found = { url, format: formatOf(url, lane.type), headers, serverId: this.id, serverName: this.name };
      }
      return (await this.probe(found, signal)) ? found : null;
    };

    // Every language at once (each its first working lane), so this takes no longer than before.
    const languages = [...byLanguage.keys()];
    const results = await Promise.all(languages.map(name => firstSuccess(byLanguage.get(name)!.map(resolveLane))));
    const working = languages.map((name, i) => ({ name, stream: results[i] })).filter((w): w is { name: string; stream: ExtractedStream } => w.stream !== null);
    if (working.length === 0) return null;

    // The title's own language first, then English, then a labelled lane over an unlabelled one.
    const rank = (name: string) => (name && name === wantedName ? 0 : name === 'English' ? 1 : name ? 2 : 3);
    working.sort((a, b) => rank(a.name) - rank(b.name));
    const primary = working[0].stream;
    const labelled = working.filter(w => w.name);
    const audios: AudioVariant[] = labelled.map(w => ({ label: w.name, language: w.name, url: w.stream.url, qualities: w.stream.qualities }));
    return { ...primary, audios: audios.length > 1 ? audios : undefined };
  }
}
