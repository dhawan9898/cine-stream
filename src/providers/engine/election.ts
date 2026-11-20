// election.ts - Which found stream plays, and what its Audio menu honestly says.
//
// The election is a strict order of keys, never a weighted sum, so no amount of one can make up for
// a loss on an earlier key:
//
//   1. Print       original (WEB-DL, HDRip, BluRay, the API sources) before theatrical (CAM, TS, PreDVD)
//   2. Resolution  2160p > 1440p > 1080p > 720p > 480p > less   (unknown counts as 720p)
//   3. Language    the title's language > not known > another language
//
// For regional titles (original language other than English) language comes before resolution: a
// 720p Telugu original print beats a 1080p one in another language.
//
// Ties then go to the provider that played this title last time, then to a fixed provider order (suits
// the title, trust, expected speed from the manifest, registration). Nothing learned at run time takes
// part, so the same streams always elect the same winner.
//
// Language claims are only ever taken from something that says so: the stream's playlist, or a site
// that files each language as its own release. A label is never guessed from the title's language,
// and one file is never listed under several languages (switching between them did nothing).
import type { AudioVariant, ExtractedStream } from '../core/types.ts';
import { LANGUAGE_NAMES, languageName } from '../core/language.ts';
import { printOf } from '../core/printClassifier.ts';
import { heightOf } from '../core/streamCheck.ts';

/** The label of a stream whose language is not known. */
export const UNKNOWN_LANGUAGE_LABEL = 'Default';

const RESOLUTION_CLASSES = [2160, 1440, 1080, 720, 480];
const UNKNOWN_HEIGHT = 720;

export interface ElectionContext {
  /** Display name of the title's original language ("Telugu"), when known. */
  wanted?: string;
  /** Original language known and not English: language ranks before resolution. */
  regional: boolean;
  /** The provider that played this title last time. */
  lastGoodId?: string;
  /** Fixed provider order (lower first); see ExtractorRegistry#providerOrder. */
  providerOrder: (serverId: string | undefined) => number[];
}

export function electionContext(language: string | undefined, rest: Omit<ElectionContext, 'wanted' | 'regional'>): ElectionContext {
  const code = (language ?? '').toLowerCase().split('-')[0];
  const wanted = LANGUAGE_NAMES[code];
  return { ...rest, wanted, regional: Boolean(wanted) && code !== 'en' };
}

export function streamHeight(s: ExtractedStream): number | undefined {
  return s.height ?? heightOf(s.quality) ?? heightOf(s.qualities?.map(q => heightOf(q.quality) ?? 0).sort((a, b) => b - a)[0])
    // A rendition playlist named after its height (".../720/index.m3u8", "..._1080p.m3u8").
    ?? heightOf(s.url.match(/[/_-](2160|1440|1080|720|576|480|360)p?(?=[/_.-])/i)?.[1]);
}

/** 2160, 1440, 1080, 720, 480 or 0. */
export function resolutionClass(s: ExtractedStream): number {
  const h = streamHeight(s) ?? UNKNOWN_HEIGHT;
  return RESOLUTION_CLASSES.find(c => h >= c) ?? 0;
}

/** The language names in "Hindi + Telugu", "telugu", "tel"; empty when none is a known language. */
export function namesIn(text: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (text ?? '').split(/\s*[+/,&]\s*/)) {
    const name = languageName(part);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function audioEntry(languages: string[], url: string, extra: Partial<AudioVariant> = {}): AudioVariant {
  return {
    ...extra,
    label: languages.length ? languages.join(' + ') : UNKNOWN_LANGUAGE_LABEL,
    language: languages.join(' + '),
    url
  };
}

/**
 * The stream with honest language data: `languages` set from what is known about the file at `url`,
 * and every file listed once in `audios` (several labels on one file become one "Hindi + Telugu" entry:
 * it is a multi-audio file, and the player's own track menu offers its tracks).
 */
export function normalizeLanguages(s: ExtractedStream): ExtractedStream {
  const byUrl = new Map<string, { names: string[]; first: AudioVariant }>();
  for (const a of s.audios ?? []) {
    const names = namesIn(a.language).concat(namesIn(a.label));
    const group = byUrl.get(a.url);
    if (group) {
      for (const n of names) if (!group.names.includes(n)) group.names.push(n);
    } else {
      byUrl.set(a.url, { names: [...new Set(names)], first: a });
    }
  }
  const declared = (s.languages ?? []).map(l => languageName(l)).filter((l): l is string => Boolean(l));
  const languages = [...new Set(declared.length ? declared : byUrl.get(s.url)?.names ?? [])];
  const audios = s.audios
    ? [...byUrl.entries()].map(([url, g]) => {
        const names = url === s.url ? languages : g.names;
        const { label: _l, language: _g, url: _u, ...rest } = g.first;
        return audioEntry(names, url, rest);
      })
    : undefined;
  return { ...s, languages: languages.length ? languages : undefined, audios };
}

/** 0: plays (or switches within the same source to) the wanted language; 1: not known; 2: another language. */
export function languageRank(s: ExtractedStream, wanted: string | undefined): number {
  if (!wanted) return 1;
  const own = s.languages ?? [];
  if (own.includes(wanted)) return 0;
  const sameSource = (s.audios ?? []).filter(a => !a.otherSource).flatMap(a => namesIn(a.language || a.label));
  if (sameSource.includes(wanted)) return 0;
  return own.length > 0 ? 2 : 1;
}

function keys(s: ExtractedStream, ctx: ElectionContext): number[] {
  const print = printOf(s) === 'original' ? 0 : 1;
  const resolution = -resolutionClass(s);
  const language = languageRank(s, ctx.wanted);
  const remembered = ctx.lastGoodId && s.serverId === ctx.lastGoodId ? 0 : 1;
  const quality = ctx.regional ? [print, language, resolution] : [print, resolution, language];
  return [...quality, remembered, ...ctx.providerOrder(s.serverId)];
}

export function compareStreams(a: ExtractedStream, b: ExtractedStream, ctx: ElectionContext): number {
  const ka = keys(a, ctx);
  const kb = keys(b, ctx);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The winner of the election (stable: the input order never matters). */
export function elect(streams: ExtractedStream[], ctx: ElectionContext): ExtractedStream | null {
  return [...streams].sort((a, b) => compareStreams(a, b, ctx) || a.url.localeCompare(b.url))[0] ?? null;
}

/**
 * Nothing found later can beat this stream on print, resolution class 1080p+ or (regional titles)
 * language: the race need not wait for more. A stream of unknown height does not hold the race up.
 */
export function isSettled(s: ExtractedStream, ctx: ElectionContext): boolean {
  if (printOf(s) !== 'original') return false;
  if ((streamHeight(s) ?? 1080) < 1080) return false;
  return !ctx.regional || languageRank(s, ctx.wanted) === 0;
}

/**
 * The main stream with the languages it lacks added from other providers' streams. Each added
 * language is a whole stream of its own (the player switches to it at the same position) with its own
 * request headers. Only languages that are known are added, and none the main stream already has.
 */
export function withExtraLanguages(main: ExtractedStream, extras: ExtractedStream[]): ExtractedStream {
  const m = normalizeLanguages(main);
  const own = m.audios?.length ? m.audios : [audioEntry(m.languages ?? [], m.url)];
  const audios = [...own];
  const present = new Set(own.flatMap(a => namesIn(a.language || a.label)));
  for (const raw of extras) {
    const extra = normalizeLanguages(raw);
    const offered = [...(extra.audios ?? [])];
    if (extra.languages?.length && !offered.some(a => a.url === extra.url)) {
      offered.unshift(audioEntry(extra.languages, extra.url, { qualities: extra.qualities }));
    }
    for (const a of offered) {
      const names = namesIn(a.language || a.label);
      if (names.length === 0 || names.every(n => present.has(n))) continue;
      names.forEach(n => present.add(n));
      audios.push({ ...a, headers: a.headers ?? extra.headers, otherSource: true });
    }
  }
  return audios.length > own.length ? { ...m, audios } : m;
}
