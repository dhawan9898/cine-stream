// movyExtractor.ts - Movy (movy.sx's backend api.wecollege.net), ported from Kunai (MIT, github.com/KitsuneKode/kunai).
//   1. GET /seed?mediaId=<tmdb>               -> { seed, ttlMs }
//   2. GET /<lane>/sources?...&enc=2&seed=..  -> ciphertext; decrypts with the seed to { sources: [...], subtitles: [...] }
// Each lane is a different upstream scraper, so lanes are tried a few at a time and the first with a stream wins.
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';
import { Cooldown, KUNAI_UA, firstSuccess, formatOf, qualityRank, toSubtitles } from './kunaiCommon.ts';
import { decryptMovyPayload } from './movyCrypto.ts';

const API = 'https://api.wecollege.net';
const REFERER = 'https://www.movy.sx/';
const ORIGIN = 'https://www.movy.sx';
const LANES = ['miami', 'boise', 'atlanta', 'phoenix', 'munich', 'seattle', 'portland', 'paris', 'cancun', 'austin', 'dallas', 'delhi', 'orlando', 'tampa', 'berlin'];
// Few at a time: the API answers 429 to a burst, and then to everything for a while.
const LANES_AT_ONCE = 3;
const MAX_LANES_TRIED = 9;

interface Row { url?: string; quality?: string; type?: string; server?: string }
interface Payload { sources?: Row[]; subtitles?: { url?: string; file?: string; lang?: string; language?: string; label?: string }[] }

const seeds = new Map<number, { seed: string; expires: number }>();

export class MovyExtractor extends BaseExtractor {
  id = 'movy';
  name = 'Movy';
  mainUrl = API;
  tier = 'primary' as const;
  private cooldown = new Cooldown();

  private get headers() {
    return { 'User-Agent': KUNAI_UA, Referer: REFERER, Origin: ORIGIN, Accept: '*/*' };
  }

  private async seed(mediaId: number, signal?: AbortSignal, fresh = false): Promise<string> {
    const hit = seeds.get(mediaId);
    if (!fresh && hit && hit.expires - 5000 > Date.now()) return hit.seed;
    let raw: string;
    try { raw = await this.httpGet(`${API}/seed?mediaId=${mediaId}`, this.headers, { signal, timeoutMs: 3000 }); } catch (e) { this.cooldown.noteError(e); throw e; }
    const body = JSON.parse(raw) as { seed?: string; ttlMs?: number };
    if (!body?.seed) throw new Error('no seed');
    seeds.set(mediaId, { seed: body.seed, expires: Date.now() + (body.ttlMs && body.ttlMs > 0 ? body.ttlMs : 30_000) });
    return body.seed;
  }

  private async lane(lane: string, p: Record<string, string>, mediaId: number, signal?: AbortSignal): Promise<Payload | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const seed = await this.seed(mediaId, signal, attempt > 0);
      const q = new URLSearchParams({ ...p, enc: '2', seed });
      try {
        const cipher = await this.httpGet(`${API}/${lane}/sources?${q}`, this.headers, { signal, timeoutMs: 5000 });
        return JSON.parse(decryptMovyPayload(cipher, seed, mediaId)) as Payload;
      } catch (e) {
        if (this.cooldown.noteError(e) || attempt === 1 || signal?.aborted) return null;
      }
    }
    return null;
  }

  async extract(params: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number; title?: string; signal?: AbortSignal }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1, title = '', signal } = params;
    if (this.cooldown.active) return null;
    const laneParams: Record<string, string> = {
      // The site encodes the title before the query layer encodes it again.
      title: encodeURIComponent(title),
      mediaType: type,
      year: '',
      totalSeasons: '1',
      seasonId: String(season),
      episodeId: String(episode),
      tmdbId: String(id),
      imdbId: ''
    };
    for (let i = 0; i < MAX_LANES_TRIED; i += LANES_AT_ONCE) {
      if (signal?.aborted || this.cooldown.active) return null;
      const batch = LANES.slice(i, i + LANES_AT_ONCE);
      const hit = await firstSuccess(batch.map(async lane => {
        const payload = await this.lane(lane, laneParams, id, signal);
        const rows = (payload?.sources ?? []).filter(r => r.url?.startsWith('http'));
        if (!payload || rows.length === 0) return null;
        rows.sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
        const best = rows[0];
        const headers = { Referer: REFERER, Origin: ORIGIN, 'User-Agent': KUNAI_UA };
        const qualities = rows.length > 1 && formatOf(best.url!, best.type) === 'mp4'
          ? rows.map(r => ({ quality: String(r.quality ?? ''), url: r.url! })) : undefined;
        const found: ExtractedStream = { url: best.url!, format: formatOf(best.url!, best.type), quality: best.quality, headers, subtitles: toSubtitles(payload.subtitles), qualities, serverId: this.id, serverName: `${this.name} ${lane}` };
        return (await this.probe(found, signal)) ? found : null;
      }));
      if (hit) return hit;
    }
    return null;
  }
}
