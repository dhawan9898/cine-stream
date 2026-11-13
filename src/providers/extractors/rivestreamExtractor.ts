// rivestreamExtractor.ts - Rivestream's backend API, ported from Kunai (MIT, github.com/KitsuneKode/kunai).
//   GET rivestream.app/api/backendfetch?requestID=VideoProviderServices      -> { data: [service, ...] }
//   GET ...?requestID=<movie|tv>VideoProvider&id=<tmdb>[&season&episode]&service=<s>&secretKey=<k>&proxyMode=noProxy
//        -> { data: [{ url, quality, format }] | { sources, captions } }
// secretKey is derived from the TMDB id by generateSecretKey (a custom hash, no network). Services are tried
// a few at a time; the first that answers with a stream wins.
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream, SourceManifest } from './types.ts';
import { Cooldown, KUNAI_UA, firstSuccess, formatOf, qualityRank, toSubtitles } from './kunaiCommon.ts';

const API = 'https://www.rivestream.app/api/backendfetch';
const REFERER = 'https://www.rivestream.app/';
const STATIC_SERVICES = ['apex', 'pulse', 'horizon', 'flowcast', 'asiacloud', 'citadel', 'hindicast', 'guru'];
// Services Kunai found dead: still tried, but last.
const DEMOTED = new Set(['savannah', 'prometheus', 'quasar', 'solstice', 'primevids']);
const SERVICES_TTL_MS = 24 * 60 * 60 * 1000;
const SERVICES_AT_ONCE = 6;
let servicesCache: { list: string[]; expires: number } | undefined;

const cArray = [
  "4Z7lUo",
  "gwIVSMD",
  "PLmz2elE2v",
  "Z4OFV0",
  "SZ6RZq6Zc",
  "zhJEFYxrz8",
  "FOm7b0",
  "axHS3q4KDq",
  "o9zuXQ",
  "4Aebt",
  "wgjjWwKKx",
  "rY4VIxqSN",
  "kfjbnSo",
  "2DyrFA1M",
  "YUixDM9B",
  "JQvgEj0",
  "mcuFx6JIek",
  "eoTKe26gL",
  "qaI9EVO1rB",
  "0xl33btZL",
  "1fszuAU",
  "a7jnHzst6P",
  "wQuJkX",
  "cBNhTJlEOf",
  "KNcFWhDvgT",
  "XipDGjST",
  "PCZJlbHoyt",
  "2AYnMZkqd",
  "HIpJh",
  "KH0C3iztrG",
  "W81hjts92",
  "rJhAT",
  "NON7LKoMQ",
  "NMdY3nsKzI",
  "t4En5v",
  "Qq5cOQ9H",
  "Y9nwrp",
  "VX5FYVfsf",
  "cE5SJG",
  "x1vj1",
  "HegbLe",
  "zJ3nmt4OA",
  "gt7rxW57dq",
  "clIE9b",
  "jyJ9g",
  "B5jXjMCSx",
  "cOzZBZTV",
  "FTXGy",
  "Dfh1q1",
  "ny9jqZ2POI",
  "X2NnMn",
  "MBtoyD",
  "qz4Ilys7wB",
  "68lbOMye",
  "3YUJnmxp",
  "1fv5Imona",
  "PlfvvXD7mA",
  "ZarKfHCaPR",
  "owORnX",
  "dQP1YU",
  "dVdkx",
  "qgiK0E",
  "cx9wQ",
  "5F9bGa",
  "7UjkKrp",
  "Yvhrj",
  "wYXez5Dg3",
  "pG4GMU",
  "MwMAu",
  "rFRD5wlM",
];


export function generateSecretKey(e: string | number) {
  if (e === undefined) return "rive";
  try {
    let t, n;
    const r = String(e);
    if (isNaN(Number(e))) {
      const sum = r.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
      t = cArray[sum % cArray.length] || btoa(r);
      n = Math.floor((sum % r.length) / 2);
    } else {
      const i = Number(e);
      t = cArray[i % cArray.length] || btoa(r);
      n = Math.floor((i % r.length) / 2);
    }

    const i = r.slice(0, n) + t + r.slice(n);

    const hash2 = (e: string) => {
      let t = 0;
      for (let n = 0; n < e.length; n++) {
        const r = e.charCodeAt(n);
        const i =
          (((t = (r + (t << 6) + (t << 16) - t) >>> 0) << (n % 5)) | (t >>> (32 - (n % 5)))) >>> 0;
        t ^= (i ^ ((r << (n % 7)) | (r >>> (8 - (n % 7))))) >>> 0;
        t = (t + ((t >>> 11) ^ (t << 3))) >>> 0;
      }
      t ^= t >>> 15;
      t = ((65535 & t) * 49842 + ((((t >>> 16) * 49842) & 65535) << 16)) >>> 0;
      t ^= t >>> 13;
      t = ((65535 & t) * 40503 + ((((t >>> 16) * 40503) & 65535) << 16)) >>> 0;
      return (t ^= t >>> 16).toString(16).padStart(8, "0");
    };

    const o = (e: string) => {
      let t = String(e);
      let n = 3735928559 ^ t.length;
      for (let e = 0; e < t.length; e++) {
        const r = t.charCodeAt(e);
        let rMod = r;
        rMod ^= ((131 * e + 89) ^ (rMod << (e % 5))) & 255;
        n = (((n << 7) | (n >>> 25)) >>> 0) ^ rMod;
        const i = (65535 & n) * 60205;
        const o = ((n >>> 16) * 60205) << 16;
        n = (i + o) >>> 0;
        n ^= n >>> 11;
      }
      n ^= n >>> 15;
      n = ((65535 & n) * 49842 + (((n >>> 16) * 49842) << 16)) >>> 0;
      n ^= n >>> 13;
      n = ((65535 & n) * 40503 + (((n >>> 16) * 40503) << 16)) >>> 0;
      n ^= n >>> 16;
      n = ((65535 & n) * 10196 + (((n >>> 16) * 10196) << 16)) >>> 0;
      return (n ^= n >>> 15).toString(16).padStart(8, "0");
    };

    return btoa(o(hash2(i)));
  } catch {
    return "topSecret";
  }
}


interface Raw { url?: string; quality?: string; format?: string }
interface Answer { data?: Raw[] | { sources?: Raw[]; captions?: { url?: string; file?: string; lang?: string; language?: string; label?: string }[] } }

/** Headers a valhallastream proxy URL declares for itself (referer/origin/user-agent only). */
function proxyHeaders(url: string): Record<string, string> | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'proxy.valhallastream.com' || u.pathname !== '/m3u8') return null;
    const parsed = JSON.parse(u.searchParams.get('headers') ?? '');
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (typeof v !== 'string' || !['referer', 'origin', 'user-agent'].includes(key) || v.length > 2048 || [...v].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) continue;
      out[key === 'user-agent' ? 'User-Agent' : key === 'referer' ? 'Referer' : 'Origin'] = v.trim();
    }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

export class RivestreamExtractor extends BaseExtractor {
  id = 'rivestream';
  name = 'Rivestream';
  mainUrl = 'https://www.rivestream.app';
  // Fastest Kunai API (0.1-0.5 s); some services hand out placeholder-segment lanes.
  manifest = { idKind: 'tmdb', costHint: 'api', priorMs: 900, linkTtlMs: 2 * 60 * 1000, deepProbe: true, trust: 'api' } satisfies SourceManifest;
  private cooldown = new Cooldown();

  private get headers() { return { 'User-Agent': KUNAI_UA, Referer: REFERER }; }

  private async services(signal?: AbortSignal): Promise<string[]> {
    if (servicesCache && servicesCache.expires > Date.now()) return servicesCache.list;
    let list = STATIC_SERVICES;
    try {
      const body = JSON.parse(await this.httpGet(`${API}?requestID=VideoProviderServices&secretKey=rive&proxyMode=undefined`, this.headers, { signal, timeoutMs: 3000 })) as { data?: unknown };
      const found = Array.isArray(body.data) ? body.data.filter((s): s is string => typeof s === 'string') : [];
      if (found.length) { list = found; servicesCache = { list, expires: Date.now() + SERVICES_TTL_MS }; }
    } catch { /* static list */ }
    return list;
  }

  async extract(params: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number; signal?: AbortSignal }): Promise<ExtractedStream | null> {
    const { id, type, season = 1, episode = 1, signal } = params;
    if (this.cooldown.active) return null;
    const secretKey = generateSecretKey(id);
    const all = await this.services(signal);
    const services = [...all.filter(s => !DEMOTED.has(s.toLowerCase())), ...all.filter(s => DEMOTED.has(s.toLowerCase()))].slice(0, SERVICES_AT_ONCE);
    let url = `${API}?requestID=${type}VideoProvider&id=${id}`;
    if (type === 'tv') url += `&season=${season}&episode=${episode}`;

    // Each service is asked and its stream probed; one with a dead CDN (a 502 from the proxy) is passed over.
    return firstSuccess(services.map(async (service): Promise<ExtractedStream | null> => {
      let answer: Answer;
      try {
        answer = JSON.parse(await this.httpGet(`${url}&service=${service}&secretKey=${secretKey}&proxyMode=noProxy`, this.headers, { signal, timeoutMs: 5000 })) as Answer;
      } catch (e) { this.cooldown.noteError(e); return null; }
      const d = answer.data;
      const rows = (Array.isArray(d) ? d : d?.sources ?? []).filter(r => r?.url?.startsWith('http'))
        .sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
      if (rows.length === 0) return null;
      const best = rows[0];
      const headers = proxyHeaders(best.url!) ?? { Referer: REFERER, 'User-Agent': KUNAI_UA };
      const format = formatOf(best.url!, best.format);
      const qualities = format === 'mp4' && rows.length > 1 ? rows.map(r => ({ quality: String(r.quality ?? ''), url: r.url! })) : undefined;
      const found: ExtractedStream = { url: best.url!, format, quality: best.quality, headers, subtitles: toSubtitles(Array.isArray(d) ? [] : d?.captions), qualities, serverId: this.id, serverName: `${this.name} ${service}` };
      return (await this.probe(found, signal)) ? found : null;
    }));
  }
}
