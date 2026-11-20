// einthusan.ts - Einthusan Direct HLS Stream Extractor
// Dedicated Indian Regional catalog provider (Hindi, Tamil, Telugu, Malayalam, Kannada, Bengali, Marathi, Punjabi, Gujarati).
import { BaseExtractor } from './base.ts';
import type { ExtractedStream, ExtractParams, SourceManifest } from '../core/types.ts';
import { idMapper } from './idMapper.ts';
import { formatOf } from './kunaiCommon.ts';

const DEFAULT_MAIN_URL = 'https://einthusan.tv';
const MIRRORS = ['https://einthusan.ca', 'https://einthusan.is'];

const LANG_MAP: Record<string, string> = {
  hi: 'hindi',
  ta: 'tamil',
  te: 'telugu',
  ml: 'malayalam',
  kn: 'kannada',
  bn: 'bengali',
  mr: 'marathi',
  pa: 'punjabi',
  gu: 'gujarati'
};

const DISPLAY_LANGS: Record<string, string> = {
  hindi: 'Hindi',
  tamil: 'Tamil',
  telugu: 'Telugu',
  malayalam: 'Malayalam',
  kannada: 'Kannada',
  bengali: 'Bengali',
  marathi: 'Marathi',
  punjabi: 'Punjabi',
  gujarati: 'Gujarati'
};

export function parseEinthusanSearch(html: string): Array<{ title: string; link: string; year?: number }> {
  const items: Array<{ title: string; link: string; year?: number }> = [];
  const regex = /<a\s+[^>]*href=["'](\/movie\/watch\/[^"'\s]+)["'][^>]*>(.*?)<\/a>/gis;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const link = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (text && !items.some(i => i.link === link)) {
      const yearM = text.match(/\b(19\d{2}|20\d{2})\b/);
      items.push({ title: text, link, year: yearM ? parseInt(yearM[1], 10) : undefined });
    }
  }
  return items;
}

export function parseEinthusanStream(html: string): string | null {
  const match = html.match(/data-mp4-link=["'](https?:\/\/[^"'\s]+)["']/i)
    || html.match(/["'](https?:\/\/[^"'\s]+\.m3u8(?:\?[^"'\s]*)?)["']/i)
    || html.match(/file\s*:\s*["'](https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)["']/i);
  return match ? match[1] : null;
}

export class EinthusanExtractor extends BaseExtractor {
  id = 'einthusan';
  name = 'Einthusan Regional';
  mainUrl = DEFAULT_MAIN_URL;
  private mirrors = [...MIRRORS];

  manifest = {
    idKind: 'search',
    costHint: 'api',
    priorMs: 3200,
    strongFor: { languages: ['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu'] },
    trust: 'scraper',
    languagesOnly: true
  } satisfies SourceManifest;

  async extract(params: ExtractParams): Promise<ExtractedStream | null> {
    const { id: tmdbId, type, title, originalTitle, year, language, signal } = params;
    if (signal?.aborted) return null;
    const rawQuery = title || originalTitle;
    if (!rawQuery) return null;
    const query = rawQuery.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();

    const langCode = (language || '').toLowerCase().split('-')[0];
    const langSlug = LANG_MAP[langCode] || 'hindi';
    const langName = DISPLAY_LANGS[langSlug] || 'Hindi';

    const matched = await idMapper.map('einthusan', { tmdbId, type, title: query, originalTitle, year }, async (q: string) => {
      const cleanQ = q.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
      for (const base of [this.mainUrl, ...this.mirrors]) {
        try {
          const searchUrl = `${base}/movie/results/?lang=${langSlug}&query=${encodeURIComponent(cleanQ)}`;
          const html = await this.httpGet(searchUrl, { Referer: `${base}/` }, { signal, timeoutMs: 3500 });
          const items = parseEinthusanSearch(html);
          if (items.length > 0) {
            return items.map(i => ({ siteId: `${base}${i.link}`, title: i.title, year: i.year, type }));
          }
        } catch {
          // try next mirror
        }
      }
      return [];
    });

    if (!matched?.siteId) return null;

    try {
      const pageHtml = await this.httpGet(matched.siteId, { Referer: `${this.mainUrl}/` }, { signal, timeoutMs: 4000 });
      const streamUrl = parseEinthusanStream(pageHtml);
      if (!streamUrl) return null;

      const extracted: ExtractedStream = {
        url: streamUrl,
        format: formatOf(streamUrl, 'hls'),
        headers: { Referer: `${this.mainUrl}/`, Origin: this.mainUrl },
        // Searched in that language's catalog: the site files every film under its language.
        languages: [langName],
        releaseName: matched.title,
        serverId: this.id,
        serverName: this.name
      };

      const ok = await this.probe(extracted, signal);
      return ok ? extracted : null;
    } catch {
      return null;
    }
  }
}
