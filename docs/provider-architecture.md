# Provider architecture v2

Status: steps 1–3 and 6–8 implemented, steps 4–5 partly · 2026-11-13

## Implementation status

| Step | State | Where |
|---|---|---|
| 1 Adapter layer | Done, in a lighter form than §3.1: `StreamExtractor` gained `manifest`, `available()` and `extractAll()` (every server/lane, embeds included) instead of a separate `Source`/`Link` type. Existing extractors work unchanged. | `extractors/types.ts`, `extractors/manifest.ts` |
| 2 One ranking | Done. `KUNAI_ORDER`, `primaryId`, `isRegionalTitle`, `tier` and the fixed 3.5 s head start are gone; the race order, the head start (1.5× the second-fastest cheap provider, 0.8–3.5 s) and the final pick all come from `plannedMs`. | `extractorRegistry.ts` |
| 3 Alternates + native failover | Done. Up to 4 alternates (other servers first) are stored with each stream, passed to the player, and tried locally before any app round trip; the app hears about it through `serverSwitched`. | `streamResolver.ts#pickAlternates`, `ExoPlayerActivity#tryNextAlternate` |
| 4 Per-host rate limiter | Done for all requests through `BaseExtractor` (token bucket per host, 429 closes the host, background requests keep half the budget free). The per-extractor `Cooldown` in Movy/Rivestream is still in place alongside it. Manifest/config-driven per-host limits are not wired yet (`hostLimiter.configure` exists). | `extractors/hostLimiter.ts` |
| 5 IdMapper | Done and used by FlixHQ and Jellyfin. **Movierulz is not moved onto it yet**: it guesses page slugs rather than using a search endpoint. | `sources/idMapper.ts` |
| 6 FlixHQ (lobster + flix-cli) | Done: search, cached title match (30 d) and season/episode ids (1 d), servers → embed links, decrypt API (opt-in, Settings) with the registry's native sniffer as the fallback. Tested on recorded markup only; the live site was unreachable from the build machine. | `sources/flixhq.ts`, `sources/decryptApi.ts` |
| 7 Validator budget | Done: segment probing only for `deepProbe` sources (Rivestream, VidRock). | `baseExtractor.ts#probe` |
| 8 Self-hosted | Jellyfin done (TMDB provider-id match, direct play natively + HLS transcode, text subtitles as WebVTT). Plex not done. | `sources/jellyfin.ts`, Settings > Sources |

Decisions taken on §8's open questions: the decrypt service is **off by default** (the sniffer resolves FlixHQ
embeds instead); alternates are passed as they are and a stale one simply fails over to the next.

Goal: every provider (the four Kunai ports, the four legacy embed providers, and the planned
FlixHQ-family and self-hosted sources) plugs into one pipeline that is **fast on the first Play,
near-instant on every later one, and never dead-ends while any working source remains**.

---

## 1. Where things stand

What already works well and is kept:

| Piece | File | Keep because |
|---|---|---|
| Race with early exit, deadline, hedged sniffs | `extractors/extractorRegistry.ts` | Right shape; only the inputs change |
| Learned speed/reliability + circuit breaker | `extractors/providerStats.ts` | Becomes the planner's only ranking signal |
| Pooled native sniffer with cancellation | `webSniffer.ts`, `ExoPlayerPlugin.java` | Becomes one host resolver among several |
| Persistent link store, idle revalidation | `streamStore.ts`, `streamRevalidator.ts` | Becomes the "links" tier of a layered cache |
| Priority scheduler, speculation policy | `streamScheduler.ts`, `speculation.ts` | Unchanged |
| Remote config, kill switch | `providerConfig.ts` | Extended with manifests (§3.7) |
| Segment probe (rejects placeholder lanes) | `baseExtractor.ts#probe` | Moves into the validation stage |

What limits it as more providers arrive:

1. **One method does everything.** `StreamExtractor.extract(tmdbId) → one stream | null` hides
   search, ID mapping, episode lists, server choice, decryption and probing inside each provider.
   Nothing between those steps can be cached, shared or retried.
2. **Ordering lives in three places that can disagree.** The race order comes from
   `stats.rank` + `PRIMARY_BIAS_MS`, the head start from `tier: 'primary'`, and the final pick from
   the hard-coded `KUNAI_ORDER` → `primaryId` → vega/flixeo/cinehype/movierulz chain in
   `resolveBestStream`. A provider that the stats call fastest can still lose the pick.
3. **"Regional" is a keyword list** (`isRegionalTitle`: pushpa, devara, kalki…). It needs updating for
   every new release, and it misses most of them.
4. **Only one candidate survives.** Providers find several working lanes (Rivestream services,
   VidRock lanes) but return one. When it fails mid-playback, the native player goes
   `reloadRequested` → JS → a full fresh lookup, which takes seconds and needs the WebView's JS awake.
5. **No ID mapping for title-search sites.** The Kunai APIs take TMDB ids. FlixHQ (lobster/flix-cli)
   and Movierulz need *search → match → site id*, and Movierulz does it by guessing slugs, with
   per-title hacks. That mapping is stable for months but is redone on every lookup.
6. **Rate limits are per extractor.** `Cooldown` in `kunaiCommon.ts` and ad-hoc timeouts in each
   provider; nothing stops two providers (or a prefetch and a Play) from hammering the same host.
7. **The fallback tier waits a fixed 3.5 s** (`PRIMARY_HEAD_START_MS`) even for steps that are
   nearly free (a static `embedUrl`, a cached id). Cost isn't modelled; tier is.

## 2. What the planned ports actually are

| Project | What it really scrapes | Consequence |
|---|---|---|
| **lobster** | FlixHQ (`flixhq.to`): `/search/<q>` → `/ajax/v2/tv/seasons/<id>` → `/ajax/v2/season/episodes/<sid>` → `/ajax/v2/episode/servers/<eid>` (or `/ajax/movie/episodes/<id>`) → `/ajax/episode/sources/<sid>` → embed link → **third-party decrypt API** (`dec.eatmynerds.live`, fallback `decrypt.broggl.farm`) → m3u8 + VTT subtitles. Servers: Vidcloud, UpCloud. Title search only. | 5–6 sequential requests per episode, plus one external service that receives every embed URL. |
| **flix-cli** | Also FlixHQ (its README lists only flixhq); discontinued in favour of *luffy*. | Not a separate source. Port it as **mirrors/endpoints of the same FlixHQ source**, not as a second provider. |
| **mov-cli** | A plugin *framework* (v4, unmaintained, feature-frozen). Its official plugins are `mov-cli-files` and `mov-cli-jellyplex` (Jellyfin/Plex). | Nothing to port as a scraper. Take its **two-phase model** (search → scrape, Single/Multi results) and its Jellyfin/Plex idea: a self-hosted source is the fastest and most reliable tier there is. |

So the work is "add a FlixHQ source with two host resolvers, add a self-hosted source, and make
the pipeline handle title-search, multi-hop sources well". That shapes the design.

## 3. The design

```
            ┌───────────── Planner (one ranking: learned cost × success) ─────────────┐
 Play ──►   │                                                                          │
            │  ① Identify        ② Locate             ③ Resolve            ④ Validate   │
            │  tmdb → site id    site id → links      link → direct URL    probe        │
            │  (IdMapper)        (Source)             (HostResolver)       (Validator)  │
            │    cache 30 d        cache 1 d (lists)    decrypt / sniff      budgeted   │
            │                      links: per-TTL                                       │
            └──────────────────────────────┬───────────────────────────────────────────┘
                                           ▼
                           CandidateSet (ranked, all working URLs)
                                           │
                ┌──────────────────────────┴──────────────────────────┐
                ▼                                                     ▼
       player gets best + alternates                     persisted per link TTL
       (fails over natively, no JS hop)                 (streamStore, revalidator)
```

### 3.1 Sources: catalog → links

A **Source** knows one site's catalog. It never decrypts and never sniffs; it hands back *links*.

```ts
type IdKind = 'tmdb' | 'imdb' | 'search';

interface SourceManifest {
  id: string;                       // 'flixhq', 'rivestream', 'jellyfin'
  name: string;
  idKind: IdKind;                   // what it needs to find a title
  kinds: Array<'movie' | 'tv'>;
  languages?: string[];             // ISO 639-1; replaces isRegionalTitle's keyword list
  linkTtlMs: number;                // how long a direct URL from here stays valid (Kunai: ~2 min)
  rateLimit?: { perHost: string; rps: number; burst: number };
  costHint: 'instant' | 'api' | 'multi-hop' | 'sniff';  // seeds the planner before stats exist
  trust: 'self-hosted' | 'api' | 'scraper';             // tie-break and UI badge
}

interface Source {
  manifest: SourceManifest;
  /** Only for idKind 'search': candidates for a title, best guess first. */
  search?(q: TitleQuery, ctx: Ctx): Promise<SiteTitle[]>;
  /** Links for one movie/episode. Several are expected (servers, lanes, services). */
  links(t: SiteTitle | TmdbRef, ep: EpisodeRef | null, ctx: Ctx): AsyncIterable<Link>;
}

type Link =
  | { kind: 'direct'; url: string; format: StreamFormat; headers?: Headers; meta: LinkMeta }
  | { kind: 'embed';  url: string; host: string; headers?: Headers; meta: LinkMeta };
```

`links()` is an **async iterator**: Rivestream yields each service as it answers, and VidRock yields
each decrypted lane. The planner can start validating the first one while the rest are in flight.
That's `firstSuccess` today, but without throwing the losers away.

### 3.2 Host resolvers: embed → direct

Embed hosts (Vidcloud/UpCloud/Megacloud for FlixHQ, the embed pages of Vega/Flixeo/CineHype today)
are shared across sites. Resolving them is a separate, reusable stage, with an **ordered chain per host**:

```ts
interface HostResolver {
  id: string;                        // 'vidcloud-decrypt-api', 'native-sniffer'
  handles(link: EmbedLink): boolean;
  resolve(link: EmbedLink, ctx: Ctx): Promise<DirectLink[]>;
}
// Chain for a Vidcloud embed: local decrypt (if ever available) → decrypt API → native sniffer.
```

- The **native sniffer** becomes the universal last resort for *any* embed host. A FlixHQ embed that
  the decrypt API can't handle is still playable.
- The **third-party decrypt APIs** are a resolver with their own breaker, kill switch and remote-config
  URL, and the user can turn them off (they see every embed URL). They're never a single point of failure.

### 3.3 IdMapper: TMDB → site id, cached for weeks

For `idKind: 'search'` sources:

1. Query by original title and English title from TMDB, plus the year.
2. Score the candidates: normalised-title similarity, year ±1, type, and episode count where the site
   shows it. Accept only above a threshold. A wrong match is worse than no match.
3. Cache `tmdb:<type>:<id> → { siteId, confidence, at }` in IndexedDB for 30 days. Cache misses for
   1 day, so an absent title isn't searched on every Play.
4. For TV, cache the season/episode → site-episode-id map per show for a day.

Effect on FlixHQ: the first Play of a show pays search + seasons + episodes. Every later episode
goes straight to `servers → sources → resolve`, which is 2–3 requests instead of 6. Prefetching the
next episode warms exactly those.

Movierulz moves onto the same mapper, and its slug hacks go away.

### 3.4 Validator: probe with a budget

`probe()` today fetches master → variant → first segment before a lookup may finish, so it's on the
critical path for every fresh link. Instead:

- **Level 1 (always):** the playlist answers `#EXTM3U` / `<MPD` with the player's headers.
- **Level 2 (segment bytes):** only for sources whose stats show placeholder lanes (VidRock today),
  or for a link that will be *saved* rather than played immediately.
- **Playing a link counts as its probe.** The native startup watchdog (20 s) and stall detector already
  catch a dead link. With alternates in hand (§3.6), the cost of a bad link is one fast switch.

### 3.5 Planner: one ranking, cost-aware hedging

This replaces `tier`, `KUNAI_ORDER`, `primaryId`, `PRIMARY_BIAS_MS` and `isRegionalTitle`
with one rule:

```
score(source, title) = expected_ms_to_playable(source)          // ProviderStats, seeded by costHint
                     / success_rate(source, title.language)     // per-language buckets
                     × trust_factor                              // self-hosted < api < scraper
```

- **Start everything that's cheap at once** (cached ids, static embed URLs, JSON APIs). Only the
  *expensive* steps (sniffs, decrypt-API calls, multi-hop chains) wait for a hedge delay, and that delay
  comes from the leader's p75 latency (`hedgeDelayMs`), not a fixed 3.5 s.
- **The remembered good source** (`LastGoodStore`) keeps its head start: it's the best prior there is.
- **Language** comes from TMDB `original_language` and the user's audio preference, matched against
  `manifest.languages`. No keyword lists.
- **The pick is the ranking.** `resolveBestStream`'s hard-coded chain goes away; ties go to `trust`.

### 3.6 CandidateSet and native failover

A lookup returns a ranked **CandidateSet**: the best link plus up to ~4 alternates from *different
sources/hosts*. The set is what's stored and what's passed to the player:

- `ExoPlayerActivity` gets `alternates` (url + headers + serverId). On a fatal HTTP/parse error or a
  startup stall it switches to the next alternate **locally**. JS is told afterwards (to update stats
  and the store), instead of being asked first. This removes the slowest part of today's failover
  (`notifyReloadRequested` → JS → fresh lookup → new intent) and works while the WebView is throttled.
- When the alternates are exhausted, the current `reloadRequested` path runs a fresh lookup that
  excludes everything that failed (as `exclude` does now).
- Per-link TTL comes from the source manifest (`linkTtlMs`). That generalises `revalidateAfterMs`.

### 3.7 Shared infrastructure

- **Per-host rate limiter** (token bucket keyed by hostname, configured from manifests and remote
  config) inside `BaseExtractor.httpGet`. It replaces the per-extractor `Cooldown`. A 429 drains the host's
  bucket for its `Retry-After`. Prefetch requests take tokens only when the bucket is more than half full,
  so a user's Play never queues behind them.
- **Breakers at two levels:** per source (as now) and per host resolver, so a dead decrypt API doesn't
  open the FlixHQ breaker while the sniffer can still resolve its embeds.
- **Remote config v2:** a `sources` map with manifest overrides (enabled, mirrors, languages, rate
  limit, linkTtlMs, bias) and a `resolvers` map (enabled, endpoint URLs, for the decrypt APIs).
  Validation stays as strict as today.
- **Layered cache, by lifetime:** id map (30 d) → show structure (1 d) → links (per TTL) → negative
  (1 min to 1 d). Each layer lives in its own IndexedDB store, and the link store keeps today's
  2,000-record cap.
- **Cancellation** is end to end (already in place as of `b02ff00`): one `AbortSignal` flows from the
  player through the planner into every stage.

## 4. How each provider lands

| Provider | Source (`idKind`, cost) | Links | Resolver | Notes |
|---|---|---|---|---|
| Rivestream | tmdb, api | one `direct` per service | — | Yields services as they answer; `linkTtlMs` ≈ 2 min |
| VidRock | tmdb, api | one `direct` per lane (decrypted in-source: a fixed key, not an embed) | — | Level-2 probe on (placeholder lanes) |
| VidLink | tmdb, api | `direct` (DASH/HEVC) | — | Manifest notes HEVC; the planner prefers H.264 when the device lacks a decoder (from `MediaCodecList`) |
| Movy | tmdb, api | `direct` | — | `rateLimit` in the manifest instead of a cooldown class |
| Vega / Flixeo / CineHype | tmdb, sniff | `embed` (static `embedUrl`) | native-sniffer | Unchanged behaviour, now via the shared resolver |
| Movierulz | **search**, multi-hop | `embed`/`direct` | native-sniffer | Moves to IdMapper; slug hacks deleted; `languages: [te, hi, ta, ml, kn]` |
| **FlixHQ** (lobster + flix-cli) | **search**, multi-hop | one `embed` per server (Vidcloud, UpCloud) | decrypt-API → native-sniffer | Mirrors from config; season/episode map cached; subtitles from the resolver's answer |
| **Jellyfin / Plex** (mov-cli jellyplex idea) | search or provider ids (Jellyfin stores TMDB ids) | `direct` | — | `trust: self-hosted`, so it wins every tie; user-entered server + token, never in remote config |
| `ApiExtractor` (config-defined) | tmdb, api | `direct` | — | Becomes a generic `Source` built from a manifest |

## 5. Speed targets

"Today" figures are estimates read off the code's timeouts and head starts, not device measurements.

| Situation | Today (estimated) | Target | Where the time goes away |
|---|---|---|---|
| Saved link, fresh | instant | instant | unchanged |
| Saved link, expired token | 0.6 s check + lookup | ≤ 1.5 s | parallel alt check (shipped), alternates in the store |
| First Play, Kunai hit | 1–4 s (incl. 3-request probe) | 0.5–2 s | level-1 probe only; play-as-probe |
| First Play, only embed sources work | 3.5 s head start + 5–9 s sniff | 4–7 s | hedge from p75, not a fixed 3.5 s; sniffs start in parallel with APIs |
| FlixHQ, later episode of a show | (n/a) | 1–2 s | IdMapper + episode map cached; 2–3 requests |
| Mid-play link failure | full JS re-lookup, 5–15 s | < 2 s | native alternates |

`streamTimings.ts` already records per-phase timings; add a `phase: 'plan' | 'map' | 'resolve' |
'failover'` breakdown so each target can be checked on real devices.

## 6. Safeguards (the "never dead-ends" list)

1. Alternates from **different sources and hosts** in every CandidateSet.
2. Every external dependency (each source, each decrypt API) has a breaker, a kill switch and a timeout.
   None can block the race past its deadline.
3. The native sniffer is the last resolver for every embed host.
4. Wrong-title protection: the IdMapper's confidence threshold, plus a duration sanity check (playable
   duration vs TMDB runtime ±15 %) before a search-sourced link is saved.
5. A cancelled or offline lookup never feeds the stats, breakers or negative cache (cancellation already
   behaves this way).
6. Contract tests per source (recorded fixtures) and a nightly live canary (`scripts/test-streams.ts`)
   that can turn a source off through remote config before users hit it.

## 7. Migration plan (each step ships on its own)

1. **Adapter layer.** Introduce `Source`/`Link`/`HostResolver` types and wrap every existing extractor
   as a `Source` (an `extract` result becomes a one-item `links()`; `embedUrl` becomes an `embed` link).
   The registry consumes the new types, and behaviour is identical. *Tests: the existing registry and
   tier suites pass unchanged.*
2. **One ranking.** Delete `KUNAI_ORDER` / `primaryId` / `isRegionalTitle`; add manifests
   (`costHint`, `languages`, `trust`); the pick follows the planner. Gate it behind a remote-config flag and
   compare `streamTimings` before and after.
3. **CandidateSet + native alternates.** Keep the losers, store them, and pass `alternates` to
   `ExoPlayerActivity`, with local failover. *This is the biggest reliability win; do it before adding sources.*
4. **Per-host rate limiter** in `httpGet`; retire `Cooldown`.
5. **IdMapper** (+ IndexedDB stores); move Movierulz onto it.
6. **FlixHQ source + Vidcloud/UpCloud resolver chain** (decrypt-API resolver behind its own setting,
   sniffer fallback), mirrors from config.
7. **Validator budget**: level-1 by default, level-2 by source stats.
8. **Self-hosted source** (Jellyfin first; its API returns TMDB provider ids, so no search is needed).

Steps 1–3 change no providers and make every later port smaller. A new source then means one manifest
plus a `links()` implementation, typically under 150 lines.

## 8. Open questions

- **Decrypt APIs and privacy.** `dec.eatmynerds.live` / `decrypt.broggl.farm` receive every embed URL
  (and the requester's IP). Off by default with the sniffer resolving instead, or on by default for speed?
- **Device codec capabilities** (HEVC/AV1) should feed the planner. Do we read `MediaCodecList` once at
  start and pass it over the bridge?
- **How long can alternates be trusted?** Short-TTL Kunai links in the CandidateSet may expire before
  they're needed. Re-check them just in time (0.6 s cap), or skip them when stale?
