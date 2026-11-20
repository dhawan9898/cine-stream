# Provider architecture

How CineStream turns "play this title" into a stream. This describes the code as it is; the history of
how it got here is in `git log -- src/providers`.

## Layers

```
src/providers/
  index.ts      the only entry point for the rest of the app
  service/      what the app asks for: resolve, prefetch, forget; saved links; background work
  engine/       one lookup: plan who runs when, run the race, sniff embeds, elect the stream
  sources/      one file per site: how to get a stream for a title there
  core/         shared by all: types, manifests, HTTP + per-host limits, stream facts, language/print rules
```

Dependencies point down only: `service → engine → sources → core`. Nothing outside `src/providers`
imports a file inside it except `index.ts`; nothing in `core` knows a provider by name.

| Layer | File | Job |
|---|---|---|
| service | `resolver.ts` | Public API. Serves saved links (checked when old), coalesces concurrent asks, runs a lookup otherwise, saves what it found |
| | `lookupCache.ts` | One running lookup per key, shared by every caller; cancelled when the last caller with a signal leaves |
| | `streamStore.ts` | One record per title/episode: the played stream + every other link found, each with its own check state (IndexedDB) |
| | `scheduler.ts`, `priorityQueue.ts` | Background lookups in priority order; they yield while the user waits on one |
| | `speculation.ts` | Whether a background lookup may use the WebView sniffer (data saver, battery, visibility) |
| | `revalidator.ts` | While the app is idle, re-checks saved links; a dead one is queued for a fresh lookup |
| | `subtitles.ts`, `timings.ts` | External subtitles (OpenSubtitles), per-phase timings for Settings |
| engine | `registry.ts` | The provider list (built-in + remote config), learned health, last-good provider; plans, runs, checks and elects |
| | `planner.ts` | **Pure.** Who starts at once, who after a head start, who is waited for, which pages are blocked |
| | `race.ts` | Runs a plan; ends on a good-enough stream, on everyone done, or on the deadline; cancels the rest |
| | `sniffQueue.ts` | Hedged WebView queue: favourite first, then expected time; 2 at once, a 3rd after the hedge delay |
| | `election.ts` | **Pure.** Which stream plays: print > resolution > language (regional: print > language > resolution) > last good > fixed provider order |
| | `webSniffer.ts` | Bridge to the native pooled WebView sniffer |
| sources | `vidlink.ts`, `vidrock.ts`, `rivestream.ts`, `movy.ts` | Direct JSON APIs (TMDB id, ~1 s) |
| | `movierulz.ts`, `hdhub4u.ts`, `desicinemas.ts`, `einthusan.ts`, `isaimini.ts` | Indian-language catalogs (title search; per-language releases) |
| | `flixeo.ts`, `flixhq.ts` | Player-page scraping; FlixHQ via search + servers + decrypt API or sniffer |
| | `jellyfin.ts`, `apiProvider.ts` | The viewer's own server; JSON APIs described by remote config |
| | `base.ts`, `idMapper.ts`, `kunaiCommon.ts`, ... | Shared source helpers: HTTP helpers, probe, page walker, TMDB→site id mapping |
| core | `http.ts` | The only network path: one transport per platform, per-host budget, timeouts, cancellation, short GET memo |
| | `hostLimiter.ts` | Token bucket per host; a 429 closes the host for its Retry-After (every provider at once) |
| | `providerStats.ts` | Learned speed / success rate per provider, and the circuit breaker |
| | `streamCheck.ts` | Reads a playlist: length (wrong-film check), real resolution class, declared audio languages |
| | `manifest.ts`, `types.ts` | What a provider declares about itself (cost, id kind, strengths, trust) |
| | `language.ts`, `printClassifier.ts` | Language names and release-title languages; theatrical vs original print |
| | `providerConfig.ts`, `ttlStore.ts` | Remote kill switch / hosts / API providers; small persistent caches |

## A lookup, start to finish

1. **`resolveStream(params)`**. If the title's record has a live link for this request (the played one,
   or the picked server's), it is returned at once. If the link is older than its lifetime (short-lived
   tokens: 2 min; others: 15 min) it is checked first, capped at 0.6 s. A dead one falls over to the next
   saved link (checked side by side, 1.5 s cap) without asking any provider.
2. Otherwise one lookup runs per (title, picked server); anyone else asking for it joins that lookup.
3. **Plan** (`planner.ts`). Providers are ranked by expected time (learned, or the manifest's prior), with a
   head start for those that suit the title. Then the first rule that applies:
   - a picked server → everyone at once, that one first;
   - last time's provider → it runs alone for 1.2 s;
   - cheap ones (APIs) → they run alone for 1.5× the second-fastest's usual time (0.8–3.5 s);
   - otherwise everyone at once.

   Providers strong for the title's language always start at once and are waited for (up to 7 s).
   Excluded providers and open breakers sit out, unless nobody would be left.
4. **Race** (`race.ts`). A direct stream is checked (`streamCheck.ts`: right length for the film, real
   height, declared languages) and collected. An embed page goes to the sniff queue. The race ends 250 ms
   after a stream nothing can beat (original print, 1080p+, and the right language on a regional title),
   2 s after any other stream, when everyone is done, or at 14 s.
5. **Elect** (`election.ts`). Theatrical prints are dropped when an original exists. On English titles the
   language-only catalogs give the main stream only when nobody else has the title. Other streams of a
   known language add their languages to the Audio menu; labels come only from the playlist or a site's
   per-language release, never from a guess.
6. **Save**. One record per title: the played stream, every other direct link (the player's alternates;
   a server switch or failover starts here), the embed pages found, and the external subtitles.

## Decisions worth knowing

- **One HTTP client, with a short memo.** A provider probes a stream's playlist and the registry then reads
  the same playlist for its facts. The 20 s memo makes that one fetch. Concurrent reads share one request,
  and a caller that gives up does not cancel it for the others.
- **One failure guard per kind of failure.** Host-level rate limits live in `hostLimiter`, and a 429 closes
  the host for every provider. Provider-level unreliability lives in the circuit breaker. There are no
  per-provider cooldowns.
- **The election uses no learned speed.** Speed decides who runs first, never what plays, so the same
  streams always elect the same winner.
- **The record key identifies content only** (type, id, season, episode, language mode, language). It does
  not include the title's text or the picked server, so the same title asked from two screens is one
  record.
- **Cancellations are not failures.** A lookup or sniff cut short because the user left, or because the race
  already ended, is never recorded against a provider, its breaker or the negative cache.

## Adding a source

Write `sources/<site>.ts`: a class with `id`, `name`, `mainUrl`, a `manifest` (`idKind`, `costHint`,
`priorMs`, `trust`, and optionally `strongFor`, `languagesOnly`, `linkTtlMs`, `deepProbe`) and
`extract()` (or `extractAll()` for several servers). Extend `BaseExtractor` for `httpGet` / `probe` /
`resolveFromPage`, then register it in `engine/registry.ts`. The planner, race, election, saving and
failover need no changes. Use `languages` only for what the site states per release, and `releaseName`
for the site's own release title (it is how a theatrical print is told).

## Testing

- Unit tests sit next to the code (`*.test.ts`). The planner, election, sniff queue, HTTP client and store
  are tested on their own; the race through `engine/registry.test.ts`; the resolver end to end through
  `service/resolver.test.ts` and `sources/fourProviders.test.ts`, with stubbed providers.
- `scripts/health-check.ts`, `scripts/bench-providers.ts` and `scripts/test-streams.ts` hit the live sites.

## Open questions

- **Decrypt APIs and privacy.** FlixHQ's decrypt services receive every embed URL and the requester's IP.
  They are off by default, and the sniffer resolves the embeds instead.
- **Device codec support** (HEVC/AV1) could feed the election; today a stream the device cannot decode
  fails over in the player.
