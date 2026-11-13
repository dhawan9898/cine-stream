// flixhq.ts - FlixHQ, the site lobster (github.com/justchokingaround/lobster) and flix-cli
// (github.com/DemonKingSwarn/flix-cli) both scrape - ported once, as one source.
//
//   search    GET /search/<title-slug>                        -> cards: /movie|tv/watch-<slug>-<id>, title, year
//   seasons   GET /ajax/v2/tv/seasons/<id>                    -> "Season N" -> season id
//   episodes  GET /ajax/v2/season/episodes/<seasonId>        -> "Eps N: ..." -> episode data-id
//   servers   GET /ajax/v2/episode/servers/<dataId>  (tv)     -> data-id + "Server UpCloud"
//             GET /ajax/movie/episodes/<id>          (movie)  -> href ...-<id>.<serverId> + title "UpCloud"
//   source    GET /ajax/episode/sources/<serverId>            -> { "link": <embed url> }
//
// What the CLIs redo on every run is cached here: the title match (idMapper, 30 days) and each show's
// season/episode ids (1 day), so a later episode of a show is servers -> source only. Each server's embed is
// resolved by the decrypt API when the viewer allows it (decryptApi.ts); otherwise, or when it fails, the
// embed goes back to the registry, which sniffs it in the native WebView like any other provider's embed.
import { BaseExtractor } from '../extractors/baseExtractor.ts';
import type { ExtractedStream, ExtractParams, SourceManifest } from '../extractors/types.ts';
import { idMapper, type SiteTitle } from './idMapper.ts';
import { TtlStore } from './ttlStore.ts';
import { resolveViaDecryptApi } from './decryptApi.ts';

const SHOW_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SERVERS = 3;
// Servers whose embeds the decrypt API and the sniffer handle; others (if any) go last.
const PREFERRED_SERVERS = ['vidcloud', 'upcloud', 'megacloud', 'akcloud'];

export interface FlixServer { id: string; name: string }

const decode = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Each <a ...> tag's attributes, in document order (attribute order inside a tag does not matter). */
function anchors(html: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const m of html.matchAll(/<a\b([^>]*)>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[a[1].toLowerCase()] = decode(a[2]);
    out.push(attrs);
  }
  return out;
}

export function searchSlug(q: string): string {
  return q.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Search page -> titles (lobster: the cards split on class="flw-item"). */
export function parseSearch(html: string): SiteTitle[] {
  const out: SiteTitle[] = [];
  for (const card of html.split('class="flw-item"').slice(1)) {
    const link = card.match(/href="\/((tv|movie)\/watch-[^"]*?-(\d+))"/);
    if (!link) continue;
    const titleAttr = card.slice(card.indexOf(link[0])).match(/title="([^"]*)"/);
    const title = decode((titleAttr?.[1] ?? '').trim());
    if (!title) continue;
    const year = [...card.matchAll(/class="fdi-item[^"]*">\s*([^<]*?)\s*</g)].map(m => m[1]).find(t => /^\d{4}$/.test(t));
    out.push({
      siteId: link[3],
      type: link[2] as 'movie' | 'tv',
      title,
      year: year ? Number(year) : undefined,
      extra: { path: link[1] }
    });
  }
  return out;
}

/** Seasons list -> season number -> season id. Accepts data-id or an id at the end of the href. */
export function parseSeasons(html: string): Record<number, string> {
  const out: Record<number, string> = {};
  for (const m of html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)) {
    const attrs = m[1];
    const label = m[2];
    const n = label.match(/(\d+)/);
    const id = attrs.match(/data-id="(\d+)"/)?.[1] ?? attrs.match(/href="[^"]*-(\d+)"/)?.[1];
    if (n && id) out[Number(n[1])] = id;
  }
  return out;
}

/** Episodes list -> episode number -> data-id ("Eps 3: ..." titles; list position when unnumbered). */
export function parseEpisodes(html: string): Record<number, string> {
  const out: Record<number, string> = {};
  let index = 0;
  for (const a of anchors(html)) {
    if (!/^\d+$/.test(a['data-id'] ?? '') || a.title === undefined) continue;
    index++;
    const n = a.title.match(/Eps?\s*(\d+)/i)?.[1];
    out[n ? Number(n) : index] = a['data-id'];
  }
  return out;
}

/** TV servers list: data-id + title="Server UpCloud". */
export function parseTvServers(html: string): FlixServer[] {
  const out: FlixServer[] = [];
  for (const a of anchors(html)) {
    if (!/^\d+$/.test(a['data-id'] ?? '') || !a.title) continue;
    out.push({ id: a['data-id'], name: a.title.replace(/^Server\s+/i, '').trim() });
  }
  return out;
}

/** Movie servers list: href ".../watch-<slug>-<id>.<serverId>" + title="UpCloud" (or a data-linkid). */
export function parseMovieServers(html: string): FlixServer[] {
  const out: FlixServer[] = [];
  for (const a of anchors(html)) {
    const id = (/^\d+$/.test(a['data-linkid'] ?? '') ? a['data-linkid'] : undefined) ?? a.href?.match(/-\d+\.(\d+)$/)?.[1];
    if (a.title && id) out.push({ id, name: a.title.replace(/^Server\s+/i, '').trim() });
  }
  return out;
}

export function orderServers(servers: FlixServer[]): FlixServer[] {
  const rank = (s: FlixServer) => {
    const i = PREFERRED_SERVERS.indexOf(s.name.toLowerCase().replace(/\s+/g, ''));
    return i < 0 ? PREFERRED_SERVERS.length : i;
  };
  return [...servers].sort((a, b) => rank(a) - rank(b));
}

export class FlixHQSource extends BaseExtractor {
  id = 'flixhq';
  name = 'FlixHQ';
  mainUrl = 'https://flixhq.to';
  // Several requests per title (fewer once the title and show are cached), then decrypt or sniff.
  manifest = { idKind: 'search', costHint: 'multi-hop', priorMs: 4500, trust: 'scraper' } satisfies SourceManifest;
  private mirrors: string[] = [];
  private show = new TtlStore<Record<number, string>>('cinestream_flixhq_show_v1', 1500);

  applyConfig(override: { mainUrl?: string; mirrors?: string[] }): void {
    super.applyConfig(override);
    this.mirrors = override.mirrors ?? [];
  }

  private get ajaxHeaders() {
    return { Referer: `${this.mainUrl}/`, 'X-Requested-With': 'XMLHttpRequest' };
  }

  /** The search page, from the main host or the first mirror that answers (which then becomes the host). */
  private async search(query: string, signal?: AbortSignal): Promise<SiteTitle[]> {
    const slug = searchSlug(query);
    if (!slug) return [];
    let lastError: unknown;
    for (const base of [this.mainUrl, ...this.mirrors.filter(m => m !== this.mainUrl)]) {
      try {
        const html = await this.httpGet(`${base}/search/${slug}`, { Referer: `${base}/` }, { signal, timeoutMs: 5000 });
        if (base !== this.mainUrl) this.mainUrl = base;
        return parseSearch(html);
      } catch (e) {
        lastError = e;
        if (signal?.aborted) break;
      }
    }
    throw lastError ?? new Error('FlixHQ search failed');
  }

  private async cachedMap(key: string, fetchMap: () => Promise<Record<number, string>>): Promise<Record<number, string>> {
    const hit = this.show.get(key);
    if (hit.has && hit.value) return hit.value;
    const map = await fetchMap();
    if (Object.keys(map).length > 0) this.show.set(key, map, SHOW_TTL_MS);
    return map;
  }

  private async episodeDataId(siteId: string, season: number, episode: number, signal?: AbortSignal): Promise<string | null> {
    const seasons = await this.cachedMap(`s|${siteId}`, async () =>
      parseSeasons(await this.httpGet(`${this.mainUrl}/ajax/v2/tv/seasons/${siteId}`, this.ajaxHeaders, { signal })));
    const seasonId = seasons[season];
    if (!seasonId) return null;
    const episodes = await this.cachedMap(`e|${seasonId}`, async () =>
      parseEpisodes(await this.httpGet(`${this.mainUrl}/ajax/v2/season/episodes/${seasonId}`, this.ajaxHeaders, { signal })));
    return episodes[episode] ?? null;
  }

  private async servers(site: SiteTitle, params: ExtractParams): Promise<FlixServer[]> {
    const { signal } = params;
    if (site.type === 'movie') {
      return parseMovieServers(await this.httpGet(`${this.mainUrl}/ajax/movie/episodes/${site.siteId}`, this.ajaxHeaders, { signal }));
    }
    const dataId = await this.episodeDataId(site.siteId, params.season ?? 1, params.episode ?? 1, signal);
    if (!dataId) return [];
    return parseTvServers(await this.httpGet(`${this.mainUrl}/ajax/v2/episode/servers/${dataId}`, this.ajaxHeaders, { signal }));
  }

  private async embedLink(server: FlixServer, signal?: AbortSignal): Promise<string | null> {
    const body = await this.httpGet(`${this.mainUrl}/ajax/episode/sources/${server.id}`, this.ajaxHeaders, { signal });
    try {
      const link = (JSON.parse(body) as { link?: unknown }).link;
      return typeof link === 'string' && /^https?:\/\//.test(link) ? link : null;
    } catch {
      return body.match(/"link":"([^"]+)"/)?.[1]?.replace(/\\\//g, '/') ?? null;
    }
  }

  async extractAll(params: ExtractParams): Promise<ExtractedStream[]> {
    const { signal } = params;
    if (signal?.aborted || !params.title) return [];
    const ref = { tmdbId: params.id, type: params.type, title: params.title, originalTitle: params.originalTitle, year: params.year };
    const site = await idMapper.map(this.id, ref, q => this.search(q, signal)).catch(() => null);
    if (!site || signal?.aborted) return [];

    let servers: FlixServer[];
    try {
      servers = orderServers(await this.servers(site, params)).slice(0, MAX_SERVERS);
    } catch {
      return [];
    }
    if (servers.length === 0) return [];
    const mediaId = site.extra?.path ?? `${site.type}/watch-${site.siteId}`;

    // Every server at once: its embed link, then the decrypt API (when allowed); an unresolved embed is
    // returned as such for the registry to sniff.
    const results = await Promise.all(servers.map(async (server): Promise<ExtractedStream | null> => {
      const label = `${this.name} ${server.name}`;
      let link: string | null;
      try { link = await this.embedLink(server, signal); } catch { return null; }
      if (!link) return null;
      const direct = await resolveViaDecryptApi(link, mediaId, (u, b, s, t) => this.httpPostJson(u, b, {}, { signal: s, timeoutMs: t }), signal);
      if (direct && (await this.probe(direct, signal))) {
        return { ...direct, serverId: this.id, serverName: label };
      }
      return { url: link, format: 'hls', isFallbackEmbed: true, serverId: this.id, serverName: label };
    }));
    const found = results.filter((r): r is ExtractedStream => r !== null);
    return [...found.filter(r => !r.isFallbackEmbed), ...found.filter(r => r.isFallbackEmbed)];
  }

  async extract(params: ExtractParams): Promise<ExtractedStream | null> {
    const all = await this.extractAll(params);
    return all.find(s => !s.isFallbackEmbed) ?? all[0] ?? null;
  }
}

