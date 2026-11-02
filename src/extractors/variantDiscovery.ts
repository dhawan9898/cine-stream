// variantDiscovery.ts - Finds the language / quality choices a release page offers
// (Movierulz-style multi-audio pages list one link per language and resolution).
// Pure functions; no network access here.
import type { AudioVariant, QualityVariant } from './types.ts';
import { absolutize, unescapeText } from './streamDiscovery.ts';

export const LANGUAGE_NAMES: Record<string, string> = {
  te: 'Telugu', ta: 'Tamil', hi: 'Hindi', ml: 'Malayalam', kn: 'Kannada',
  bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', en: 'English'
};

const LANGUAGE_RE = /\b(telugu|tamil|hindi|malayalam|kannada|bengali|marathi|punjabi|gujarati|english|eng|tel|tam|hin|mal|kan)\b/i;
const LANG_ALIASES: Record<string, string> = { eng: 'English', tel: 'Telugu', tam: 'Tamil', hin: 'Hindi', mal: 'Malayalam', kan: 'Kannada' };

export interface Hint {
  language?: string; // display name, e.g. "Telugu"
  quality?: string; // e.g. "1080p"
}

export function hintOf(text: string): Hint {
  const decoded = unescapeText(text || '');
  const hint: Hint = {};
  const lang = decoded.match(LANGUAGE_RE);
  if (lang) {
    const word = lang[1].toLowerCase();
    hint.language = LANG_ALIASES[word] ?? word[0].toUpperCase() + word.slice(1);
  }
  const q = decoded.match(/\b(2160|1440|1080|720|576|480|360|240)\s*p\b/i) ?? decoded.match(/[/_.\-](2160|1440|1080|720|480|360)p?(?=[/_.\-?]|$)/i);
  if (q) hint.quality = `${q[1]}p`;
  else if (/\b4k\b/i.test(decoded)) hint.quality = '2160p';
  else if (/\bfull\s?hd\b/i.test(decoded)) hint.quality = '1080p';
  else if (/\bhd\b/i.test(decoded)) hint.quality = '720p';
  return hint;
}

export interface Candidate {
  url: string;
  hint: Hint;
}

const HOST_RE = /(streamtape|filelions|streamwish|dood|mixdrop|vidoza|vidhide|lulustream|embedrise|dropload|fastream|upstream|voe|filemoon|hls|m3u8|\.mp4|\.mkv)/i;

/** Every link on a release page that could lead to a stream, with its language/quality hint. */
export function extractCandidates(html: string, baseUrl: string): Candidate[] {
  const found = new Map<string, Candidate>();
  const add = (raw: string, context: string) => {
    const url = absolutize(unescapeText(raw), baseUrl);
    if (!url || !/^https?:/i.test(url) || !HOST_RE.test(url)) return;
    const hint = { ...hintOf(url), ...Object.fromEntries(Object.entries(hintOf(context)).filter(([, v]) => v)) } as Hint;
    const prev = found.get(url);
    if (!prev || (!prev.hint.language && hint.language) || (!prev.hint.quality && hint.quality)) found.set(url, { url, hint: { ...prev?.hint, ...hint } });
  };

  // <a href="...">Telugu 720p</a>
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    add(m[1], m[2].replace(/<[^>]+>/g, ' ') + ' ' + (m[0].match(/\b(?:title|data-[a-z-]+)\s*=\s*["']([^"']*)["']/gi)?.join(' ') ?? ''));
  }
  // data-src / data-url / data-link buttons and iframes
  for (const m of html.matchAll(/<(?:button|li|div|span|iframe|source)\b[^>]*?\b(?:data-(?:src|url|link|embed|stream)|src)\s*=\s*["']([^"']+)["'][^>]*>([^<]{0,60})/gi)) {
    add(m[1], m[0].replace(/<[^>]+>/g, ' ') + ' ' + m[2]);
  }
  // var locations/players/sources/links = ["...", ...]
  const arr = html.match(/var\s+(?:locations|players|sources|links)\s*=\s*\[([\s\S]*?)\];/);
  if (arr) for (const m of arr[1].matchAll(/["']([^"']+)["']/g)) add(m[1], '');
  return [...found.values()];
}

export interface ResolvedVariant {
  url: string;
  hint: Hint;
}

const qualityValue = (q?: string) => parseInt(q ?? '0', 10) || 0;

export interface VariantSet {
  primary: ResolvedVariant;
  qualities: QualityVariant[];
  audios: AudioVariant[];
}

/**
 * Chooses the stream to start with (the viewer's language first, then best
 * quality) and the other-language / other-resolution files to offer in the player.
 */
export function buildVariantSet(resolved: ResolvedVariant[], preferredLangCode?: string): VariantSet | null {
  const unique = [...new Map(resolved.map(r => [r.url, r])).values()];
  if (unique.length === 0) return null;

  const byLang = new Map<string, ResolvedVariant[]>();
  for (const v of unique) {
    const lang = v.hint.language ?? '';
    byLang.set(lang, [...(byLang.get(lang) ?? []), v]);
  }
  const best = (list: ResolvedVariant[]) => [...list].sort((a, b) => qualityValue(b.hint.quality) - qualityValue(a.hint.quality))[0];
  const qualitiesOf = (list: ResolvedVariant[]): QualityVariant[] => {
    const perQuality = new Map<string, ResolvedVariant>();
    for (const v of list) if (v.hint.quality && !perQuality.has(v.hint.quality)) perQuality.set(v.hint.quality, v);
    return [...perQuality.values()]
      .sort((a, b) => qualityValue(b.hint.quality) - qualityValue(a.hint.quality))
      .map(v => ({ quality: v.hint.quality!, url: v.url }));
  };

  const preferredName = preferredLangCode ? LANGUAGE_NAMES[preferredLangCode.toLowerCase()] : undefined;
  const languages = [...byLang.keys()].filter(Boolean);
  const primaryLang =
    (preferredName && byLang.has(preferredName) ? preferredName : undefined) ??
    languages[0] ??
    '';
  const primaryList = byLang.get(primaryLang) ?? unique;
  const primary = best(primaryList);

  const audios: AudioVariant[] = languages.length > 1
    ? languages.map(lang => {
        const list = byLang.get(lang)!;
        const top = lang === primaryLang ? primary : best(list);
        const qualities = qualitiesOf(list);
        return { label: lang, language: lang, url: top.url, qualities: qualities.length > 1 ? qualities : undefined };
      })
    : [];

  const qualities = qualitiesOf(primaryList);
  return { primary, qualities: qualities.length > 1 ? qualities : [], audios };
}
