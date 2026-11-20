// registry.ts - The providers, what has been learned about them, and the lookup that uses them.
//
// It owns the provider list (built-in sources plus the remote config's), their learned speed and
// health (providerStats.ts), and which provider played each title last time. A lookup is planned
// (planner.ts), run (race.ts), and its streams checked (right film, real quality and languages) and
// elected (election.ts).
import { reportError } from '../../services/errorReporter.ts';
import type { StreamExtractor, ExtractedStream } from '../core/types.ts';
import { manifestOf, priorMs, strongFor, trustRank } from '../core/manifest.ts';
import { compareStreams, electionContext, elect, isSettled, normalizeLanguages, withExtraLanguages, type ElectionContext } from './election.ts';
import { planRace } from './planner.ts';
import { RACE_LIMITS, Race, type RaceParams } from './race.ts';
import { FlixHQSource } from '../sources/flixhq.ts';
import { JellyfinSource } from '../sources/jellyfin.ts';
import { sniffDirectStream } from './webSniffer.ts';
import { LastGoodStore } from 'streamkit/providers/health.ts';
import { ProviderStats } from '../core/providerStats.ts';
import { getProviderOverride, isProviderEnabled, subscribeProviderConfig, type ProviderConfig } from '../core/providerConfig.ts';
import { ApiExtractor } from '../sources/apiProvider.ts';
import { FlixeoExtractor } from '../sources/flixeo.ts';
import { MovierulzExtractor } from '../sources/movierulz.ts';
import { VidLinkExtractor } from '../sources/vidlink.ts';
import { VidRockExtractor } from '../sources/vidrock.ts';
import { RivestreamExtractor } from '../sources/rivestream.ts';
import { MovyExtractor } from '../sources/movy.ts';
import { HDHub4UExtractor } from '../sources/hdhub4u.ts';
import { DesiCinemasExtractor } from '../sources/desicinemas.ts';
import { EinthusanExtractor } from '../sources/einthusan.ts';
import { IsaiminiExtractor } from '../sources/isaimini.ts';
import { filterBestPrintStreams } from '../core/printClassifier.ts';
import { inspectStream, isWrongLength } from '../core/streamCheck.ts';

export { withExtraLanguages } from './election.ts';

const HEALTH_KEY = 'cinestream_provider_stats_v2';
const FAILS_BEFORE_COOLDOWN = 3;
const COOLDOWN_MS = 10 * 60 * 1000;

/** Head start (ms of expected time) for a provider whose manifest says it suits the title (kind/language). */
const PRIMARY_BIAS_MS = 1500;
const LAST_GOOD_KEY = 'cinestream_last_good_v1';
// How long the film's runtime may take to arrive (it is usually cached from the title page).
const RUNTIME_WAIT_MS = 2000;
const LAST_GOOD_MAX = 300;

type Sniffer = (embed: ExtractedStream, signal?: AbortSignal, background?: boolean) => Promise<ExtractedStream | null>;

export class ExtractorRegistry {
  private extractors: StreamExtractor[] = [];
  private sniffer: Sniffer = (embed, signal, background) => sniffDirectStream(embed, RACE_LIMITS.sniffTimeoutMs, signal, background);
  // Learned speed and reliability per provider; also the circuit breaker (see providerStats.ts).
  private stats = new ProviderStats({
    storageKey: HEALTH_KEY,
    failsToOpen: FAILS_BEFORE_COOLDOWN,
    baseBackoffMs: COOLDOWN_MS / 20,
    maxBackoffMs: COOLDOWN_MS
  });
  private lastGood = new LastGoodStore(LAST_GOOD_KEY, LAST_GOOD_MAX);
  // The film's TMDB runtime in minutes (set by streamResolver.ts), to tell a wrong title by its length.
  private runtimeLookup: (id: number) => Promise<number | undefined> = async () => undefined;
  // Reads a stream's playlist (see streamCheck.ts); a registry without the default providers (tests) skips it.
  private inspect: typeof inspectStream = inspectStream;

  setStreamInspector(fn: typeof inspectStream) {
    this.inspect = fn;
  }

  setRuntimeLookup(fn: (id: number) => Promise<number | undefined>) {
    this.runtimeLookup = fn;
  }

  /** Providers that only add languages (Movierulz, HDHub4U, etc.): their stream is the main one only when nothing else is found. */
  private languagesOnly(s: ExtractedStream): boolean {
    const e = s.serverId ? this.extractors.find(x => x.id === s.serverId) : undefined;
    return Boolean(e && manifestOf(e).languagesOnly);
  }

  /**
   * The fixed order the election falls back on when streams tie on print, resolution and language:
   * suits the title (kind / language), trust, the manifest's expected speed (with the remote-config
   * bias), registration order. Learned speed is left out on purpose: it drifts from one lookup to the
   * next, and the played provider must not change with it.
   */
  private providerOrder(title: { type: 'movie' | 'tv'; language?: string }): (serverId: string | undefined) => number[] {
    return serverId => {
      const index = this.extractors.findIndex(x => x.id === serverId);
      if (index < 0) return [1, 2, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
      const e = this.extractors[index];
      return [strongFor(e, title) ? 0 : 1, trustRank(e), priorMs(e) - (getProviderOverride(e.id)?.bias ?? 0), index];
    };
  }

  private election(params: { id: number; type: 'movie' | 'tv'; language?: string }): ElectionContext {
    return electionContext(params.language, {
      lastGoodId: this.lastGood.get(`${params.type}:${params.id}`),
      providerOrder: this.providerOrder(params)
    });
  }

  /**
   * Looks inside a found stream: drops one whose length does not fit the film (another title), and
   * notes its real height for the final pick. Unknown length or an unreadable playlist passes.
   */
  private async checkStream(stream: ExtractedStream, runtime: Promise<number | undefined>, title: { id: number; title?: string }, signal?: AbortSignal): Promise<boolean> {
    const [facts, expected] = await Promise.all([this.inspect(stream, signal).catch(() => ({})), runtime]) as [Awaited<ReturnType<typeof inspectStream>>, number | undefined];
    if (facts.height) stream.height = facts.height;
    // What the playlist itself declares beats any label the provider put on the stream.
    if (facts.languages?.length) stream.languages = facts.languages;
    if (!isWrongLength(facts.minutes, expected)) return true;
    // Not counted against the provider: a wrong title is about this film (often a regional one sharing
    // its name with another), and three of them must not switch a good provider off for every title.
    reportError('provider', `${stream.serverName ?? stream.serverId} gave a different title (${Math.round(facts.minutes!)} min, film is ${expected} min)`, {
      provider: stream.serverId, title: title.title, id: title.id
    });
    return false;
  }

  private rememberGood(params: { id: number; type: string }, serverId?: string) {
    this.lastGood.remember(`${params.type}:${params.id}`, serverId);
  }

  // `ms` is the time from the request to a playable stream (successes only).
  private recordResult(id: string, ok: boolean, ms?: number) {
    // No network says nothing about the provider.
    if (!ok && typeof navigator !== 'undefined' && navigator.onLine === false) return;
    this.stats.record(id, ok, ms);
  }

  /** Forgets which provider played each title (Settings > Clear Cache). Speed and health stay learned. */
  forgetLastGood(): void {
    this.lastGood.clear();
  }

  /** What has been learned so far, for diagnostics. */
  providerStats() {
    return this.stats.snapshot();
  }

  setSniffer(fn: Sniffer) {
    this.sniffer = fn;
  }

  constructor(withDefaults = true) {
    if (!withDefaults) {
      this.inspect = async () => ({});
      return;
    }
    // The Kunai direct-API providers answer from JSON APIs in about a second (no embed page to sniff),
    // so they lead; the four embed-based providers below are the fallback tier.
    this.register(new VidLinkExtractor());
    this.register(new VidRockExtractor());
    this.register(new RivestreamExtractor());
    this.register(new MovyExtractor());
    this.register(new MovierulzExtractor());
    this.register(new HDHub4UExtractor());
    this.register(new DesiCinemasExtractor());
    this.register(new EinthusanExtractor());
    this.register(new IsaiminiExtractor());
    this.register(new FlixeoExtractor());
    // Ported from lobster / flix-cli (both scrape FlixHQ): title search, cached id mapping, one embed per server.
    this.register(new FlixHQSource());
    // mov-cli's jellyplex idea: the viewer's own Jellyfin server, when they set one up (Settings).
    this.register(new JellyfinSource());
    // Remote config: kill switch, new hosts, API providers (see providerConfig.ts).
    subscribeProviderConfig(cfg => this.applyConfig(cfg));
  }

  private configured = new Set<string>();

  private applyConfig(cfg: ProviderConfig) {
    // Hosts and mirrors of the built-in providers.
    for (const e of this.extractors) {
      const o = cfg.providers[e.id];
      (e as { applyConfig?: (o: { mainUrl?: string; mirrors?: string[] }) => void }).applyConfig?.(o ?? {});
    }
    // Providers that exist only in the config: add new ones, drop ones that were removed.
    const wanted = new Set(cfg.apiProviders.map(a => a.id).filter(id => !this.extractors.some(e => e.id === id && !this.configured.has(id))));
    this.extractors = this.extractors.filter(e => !this.configured.has(e.id) || wanted.has(e.id));
    this.configured = new Set([...this.configured].filter(id => wanted.has(id)));
    for (const spec of cfg.apiProviders) {
      if (!wanted.has(spec.id)) continue;
      this.extractors = this.extractors.filter(e => e.id !== spec.id);
      this.extractors.push(new ApiExtractor(spec));
      this.configured.add(spec.id);
    }
  }

  register(extractor: StreamExtractor) {
    this.extractors.push(extractor);
  }

  getAllExtractors(): StreamExtractor[] {
    return this.extractors.filter(e => isProviderEnabled(e.id) && (e.available?.() ?? true));
  }

  /**
   * The planner's one number: expected ms to a playable stream for this title. What has been learned
   * (speed / success rate) once there is any, the manifest's prior until then; minus a head start when
   * the manifest says the provider suits the title, and the remote-config bias.
   */
  private plannedMs(e: StreamExtractor, title: { type: 'movie' | 'tv'; language?: string }): number {
    const base = this.stats.measured(e.id) ? this.stats.expectedMs(e.id) : priorMs(e);
    return base - (strongFor(e, title) ? PRIMARY_BIAS_MS : 0) - (getProviderOverride(e.id)?.bias ?? 0);
  }

  /**
   * Every checked direct stream for the title, best first (see planner.ts for who runs when and
   * race.ts for when the lookup ends). Embed pages are never returned: they are sniffed, or handed to
   * `onEmbed` to be saved.
   */
  async resolveAllStreams(params: RaceParams & { directOnly?: boolean; fresh?: boolean; exclude?: string[] }): Promise<ExtractedStream[]> {
    const plan = planRace(this.getAllExtractors(), params, {
      plannedMs: e => this.plannedMs(e, params),
      admit: e => this.stats.tryAcquire(e.id),
      lastGoodId: this.lastGood.get(`${params.type}:${params.id}`)
    });
    const election = this.election(params);
    const runtime: Promise<number | undefined> = params.type === 'movie'
      ? Promise.race([
          this.runtimeLookup(params.id).catch(() => undefined),
          new Promise<undefined>(r => setTimeout(() => r(undefined), RUNTIME_WAIT_MS))
        ])
      : Promise.resolve(undefined);
    const found = await new Race(plan, params, {
      check: (stream, signal) => this.checkStream(stream, runtime, params, signal),
      sniff: (embed, signal, background) => this.sniffWithTimeout(embed, RACE_LIMITS.sniffTimeoutMs, signal, background),
      recordResult: (id, ok, ms) => this.recordResult(id, ok, ms),
      expectedMs: id => this.stats.expectedMs(id),
      hedgeDelayMs: id => this.stats.hedgeDelayMs(id),
      languagesOnly: s => this.languagesOnly(s),
      election
    }).run();

    const sorted = [...found].sort((x, y) => {
      if (params.preferredServerId) {
        if (x.serverId === params.preferredServerId) return -1;
        if (y.serverId === params.preferredServerId) return 1;
      }
      // Best first by the election's order; on an English title the language-only providers go
      // last: they are the final fallback, not the next one.
      return (election.regional ? 0 : Number(this.languagesOnly(x)) - Number(this.languagesOnly(y)))
        || compareStreams(x, y, election);
    });
    // Remembered: the stream the election picks, not whichever arrived first.
    const winner = this.electMain(filterBestPrintStreams(sorted), params);
    if (winner) this.rememberGood(params, winner.serverId);
    return sorted;
  }

  /** Turns a saved embed page into a direct stream with the native sniffer, or null. */
  sniffEmbed(embed: ExtractedStream, ms = RACE_LIMITS.sniffTimeoutMs): Promise<ExtractedStream | null> {
    return this.sniffWithTimeout(embed, ms);
  }

  private async sniffWithTimeout(embed: ExtractedStream, ms: number, signal?: AbortSignal, background?: boolean): Promise<ExtractedStream | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stream = await Promise.race([
        (async () => this.sniffer(embed, signal, background))(),
        new Promise<null>(r => { timer = setTimeout(() => r(null), ms); })
      ]);
      return stream && stream.url ? stream : null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async resolveBestStream(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    language?: string;
    languageMode?: string;
    preferredServerId?: string;
    directOnly?: boolean;
  }, precomputed?: ExtractedStream[]): Promise<ExtractedStream | null> {
    const directStreams = (precomputed ?? await this.resolveAllStreams(params))
      .filter(s => !s.isFallbackEmbed)
      .map(normalizeLanguages);
    // An original print is there: theatrical ones are neither played nor offered as a language.
    const all = filterBestPrintStreams(directStreams);
    if (all.length === 0) return null;

    if (params.preferredServerId) {
      const preferred = all.find(s => s.serverId === params.preferredServerId);
      if (preferred) return preferred;
    }

    const best = this.electMain(all, params);
    if (!best) return null;
    this.rememberGood(params, best.serverId);
    // Every other stream of a known language lends the languages the main one lacks; the
    // language-only providers' come last.
    const extras = all.filter(s => s !== best && ((s.audios?.length ?? 0) > 0 || (s.languages?.length ?? 0) > 0))
      .sort((a, b) => Number(this.languagesOnly(a)) - Number(this.languagesOnly(b)));
    return extras.length ? withExtraLanguages(best, extras) : best;
  }

  /**
   * The stream that plays (see streamElection.ts for the order). On an English (or unknown-language)
   * title the language-only providers - Indian sites whose copies are mostly Hindi / regional dubs -
   * give the main stream only when nobody else has the title. On a regional title they compete like
   * everyone else: they often have the original-language release.
   */
  private electMain(all: ExtractedStream[], params: { id: number; type: 'movie' | 'tv'; language?: string }): ExtractedStream | null {
    const ctx = this.election(params);
    const main = ctx.regional ? all : all.filter(s => !this.languagesOnly(s));
    return elect(main.length ? main : all, ctx);
  }
}

export const extractorRegistry = new ExtractorRegistry();
