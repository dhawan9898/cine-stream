// subtitleService.ts - External subtitles for a TMDB title, looked up by IMDb id
// from the public OpenSubtitles Stremio addon (no API key). Never throws.
import { CINEHYPE_TMDB_KEY, TMDB_API_BASE } from './cineHypeCore.ts';
import type { ExtractorSubtitle } from './extractors/types.ts';

const ADDON = 'https://opensubtitles-v3.strem.io/subtitles';
const TIMEOUT_MS = 5000;
const MAX_PER_LANGUAGE = 2;

// Languages offered, in menu order (ISO 639-2 codes used by the addon).
const LANGUAGES: Array<[string, string]> = [
  ['eng', 'English'], ['hin', 'Hindi'], ['tel', 'Telugu'], ['tam', 'Tamil'],
  ['mal', 'Malayalam'], ['kan', 'Kannada'], ['fre', 'French'], ['spa', 'Spanish'],
  ['ara', 'Arabic'], ['por', 'Portuguese'], ['ger', 'German']
];

const imdbCache = new Map<string, Promise<string | null>>();

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function imdbIdOf(id: number, type: 'movie' | 'tv'): Promise<string | null> {
  const key = `${type}${id}`;
  let p = imdbCache.get(key);
  if (!p) {
    p = getJson<{ imdb_id?: string }>(`${TMDB_API_BASE}/${type}/${id}/external_ids?api_key=${CINEHYPE_TMDB_KEY}`)
      .then(d => d?.imdb_id || null);
    imdbCache.set(key, p);
    p.then(v => { if (!v) imdbCache.delete(key); });
  }
  return p;
}

export async function fetchSubtitles(params: {
  id: number; type: 'movie' | 'tv'; season?: number; episode?: number;
}): Promise<ExtractorSubtitle[]> {
  try {
    const imdb = await imdbIdOf(params.id, params.type);
    if (!imdb) return [];
    const path = params.type === 'tv'
      ? `series/${imdb}:${params.season ?? 1}:${params.episode ?? 1}`
      : `movie/${imdb}`;
    const data = await getJson<{ subtitles?: Array<{ url?: string; lang?: string }> }>(`${ADDON}/${path}.json`);
    const list = data?.subtitles ?? [];
    const out: ExtractorSubtitle[] = [];
    for (const [code, name] of LANGUAGES) {
      list.filter(s => s.url && s.lang === code).slice(0, MAX_PER_LANGUAGE).forEach((s, i) => {
        out.push({
          url: s.url!,
          lang: code,
          label: i === 0 ? name : `${name} ${i + 1}`,
          mimeType: 'application/x-subrip'
        });
      });
    }
    return out;
  } catch {
    return [];
  }
}
