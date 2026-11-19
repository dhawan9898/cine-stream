// desicinemasExtractor.ts - DesiCinemas Direct HLS Stream Extractor
// Scrapes DesiCinemas catalog for Hindi, Punjabi, Tamil, and Telugu releases.
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream, ExtractParams, SourceManifest } from './types.ts';
import { languagesIn } from './variantDiscovery.ts';
import { idMapper } from '../sources/idMapper.ts';
import { formatOf } from './kunaiCommon.ts';

const DEFAULT_MAIN_URL = 'https://desicinemas.tv';
const MIRRORS = ['https://desicinemas.org', 'https://desicinemas.net'];

export function parseDesiSearch(html: string): Array<{ title: string; link: string; year?: number }> {
  const results: Array<{ title: string; link: string; year?: number }> = [];
  const regex = /<a\s+[^>]*href=["'](https?:\/\/[^"'\s]+\/(?:watch|movie|tv)\/[^"'\s]+)["'][^>]*>(.*?)<\/a>/gis;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const link = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (text && !results.some(r => r.link === link)) {
      const yearM = text.match(/\b(19\d{2}|20\d{2})\b/);
      results.push({ title: text, link, year: yearM ? parseInt(yearM[1], 10) : undefined });
    }
  }
  return results;
}

export function parseDesiM3u8(html: string): string | null {
  const match = html.match(/(?:file|src|source)\s*:\s*["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i)
    || html.match(/["'](https?:\/\/[^"'\s]+\.m3u8(?:\?[^"'\s]*)?)["']/i);
  return match ? match[1] : null;
}

export class DesiCinemasExtractor extends BaseExtractor {
  id = 'desicinemas';
  name = 'DesiCinemas Direct';
  mainUrl = DEFAULT_MAIN_URL;
  private mirrors = [...MIRRORS];

  manifest = {
    idKind: 'search',
    costHint: 'api',
    priorMs: 2800,
    strongFor: { languages: ['hi', 'pa', 'te', 'ta'] },
    trust: 'api',
    languagesOnly: true
  } satisfies SourceManifest;

  async extract(params: ExtractParams): Promise<ExtractedStream | null> {
    const { id: tmdbId, type, title, originalTitle, year, signal } = params;
    if (signal?.aborted) return null;
    const rawQuery = title || originalTitle;
    if (!rawQuery) return null;
    const query = rawQuery.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();

    const matched = await idMapper.map('desicinemas', { tmdbId, type, title: query, originalTitle, year }, async (q: string) => {
      const cleanQ = q.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
      for (const base of [this.mainUrl, ...this.mirrors]) {
        try {
          const searchUrl = `${base}/?s=${encodeURIComponent(cleanQ)}`;
          const html = await this.httpGet(searchUrl, { Referer: `${base}/` }, { signal, timeoutMs: 3000 });
          const items = parseDesiSearch(html);
          if (items.length > 0) {
            return items.map(i => ({ siteId: i.link, title: i.title, year: i.year, type }));
          }
        } catch {
          // next mirror
        }
      }
      return [];
    });

    if (!matched?.siteId) return null;

    try {
      const pageHtml = await this.httpGet(matched.siteId, { Referer: `${this.mainUrl}/` }, { signal, timeoutMs: 4000 });
      const m3u8Url = parseDesiM3u8(pageHtml);
      if (!m3u8Url) return null;
      // The languages the release names (a multi-audio file names several); none named stays unknown.
      const languages = languagesIn(matched.title, query);

      const extracted: ExtractedStream = {
        url: m3u8Url,
        format: formatOf(m3u8Url, 'hls'),
        headers: { Referer: `${this.mainUrl}/`, Origin: this.mainUrl },
        languages: languages.length > 0 ? languages : undefined,
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
