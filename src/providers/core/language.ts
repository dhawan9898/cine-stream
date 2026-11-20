// language.ts - The languages the app knows: names, codes, and the languages a release title names.
// Pure functions; no network access here.
import { unescapeText } from './streamDiscovery.ts';

export const LANGUAGE_NAMES: Record<string, string> = {
  te: 'Telugu', ta: 'Tamil', hi: 'Hindi', ml: 'Malayalam', kn: 'Kannada',
  bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', en: 'English'
};

const NAME_SET = new Set(Object.values(LANGUAGE_NAMES));
const ISO3: Record<string, string> = {
  eng: 'English', tel: 'Telugu', tam: 'Tamil', hin: 'Hindi', mal: 'Malayalam', kan: 'Kannada',
  ben: 'Bengali', mar: 'Marathi', pan: 'Punjabi', guj: 'Gujarati'
};

/**
 * A language code ("te", "tel", "te-IN") or name ("telugu", "Telugu Dubbed") as its display name, or
 * undefined when it is none of the languages the app knows ("und", "", a server name).
 */
export function languageName(value: string | undefined | null): string | undefined {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return undefined;
  const code = v.split(/[-_]/)[0];
  if (LANGUAGE_NAMES[code]) return LANGUAGE_NAMES[code];
  if (ISO3[code]) return ISO3[code];
  const word = v.match(/^[a-z]+/)?.[0] ?? '';
  const name = word ? word[0].toUpperCase() + word.slice(1) : '';
  return NAME_SET.has(name) ? name : undefined;
}

const LANGUAGE_WORDS_RE = /\b(telugu|tamil|hindi|malayalam|kannada|bengali|marathi|punjabi|gujarati|english)\b/gi;

/**
 * Every language named in a release title ("Kalki 2898 AD (2024) Telugu + Hindi HDRip"), in order,
 * without guessing when none is named. The film's own title is taken out first, so "English Vinglish"
 * is not an English release.
 */
export function languagesIn(text: string | undefined, filmTitle?: string): string[] {
  let t = unescapeText(text ?? '').toLowerCase();
  const own = (filmTitle ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (own) t = t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').replace(own, ' ');
  const out: string[] = [];
  for (const m of t.matchAll(LANGUAGE_WORDS_RE)) {
    const name = languageName(m[1]);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}
