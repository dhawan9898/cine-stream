// isaiminiExtractor.ts - Isaimini South Regional Direct Stream Extractor
// Scrapes South Indian catalog (Tamil, Telugu, Malayalam, Kannada) for direct MP4 and HLS streams.
import { BaseExtractor } from './baseExtractor.ts';
import type { AudioVariant, ExtractedStream, ExtractParams, SourceManifest } from './types.ts';
import { idMapper } from '../sources/idMapper.ts';
import { formatOf } from './kunaiCommon.ts';

const DEFAULT_MAIN_URL = 'https://isaimini.vip';
const MIRRORS = ['https://isaimini.net', 'https://isaimini.org'];

export function parseIsaiminiSearch(html: string): Array<{ title: string; link: string; year?: number }> {
  const list: Array<{ title: string; link: string; year?: number }> = [];
  const regex = /<a\s+[^>]*href=["'](https?:\/\/[^"'\s]+\/(?:movie|tamil|telugu|malayalam|kannada)[^"'\s]*)["'][^>]*>(.*?)<\/a>/gis;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const link = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (text && !list.some(i => i.link === link)) {
      const yearM = text.match(/\b(19\d{2}|20\d{2})\b/);
      list.push({ title: text, link, year: yearM ? parseInt(yearM[1], 10) : undefined });
    }
  }
  return list;
}

export function parseIsaiminiStream(html: string): string | null {
  const match = html.match(/href=["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)(?:\?[^"'\s]*)?)["']/i);
  return match ? match[1] : null;
}

function detectSouthAudio(cardTitle: string, streamUrl: string): AudioVariant[] {
  const text = cardTitle.toLowerCase();
  const audios: AudioVariant[] = [];
  const check = (lang: string) => {
    if (text.includes(lang.toLowerCase())) audios.push({ label: lang, language: lang, url: streamUrl });
  };
  check('Tamil');
  check('Telugu');
  check('Malayalam');
  check('Kannada');
  if (audios.length === 0) audios.push({ label: 'Tamil', language: 'Tamil', url: streamUrl });
  return audios;
}

export class IsaiminiExtractor extends BaseExtractor {
  id = 'isaimini';
  name = 'Isaimini South Direct';
  mainUrl = DEFAULT_MAIN_URL;
  private mirrors = [...MIRRORS];

  manifest = {
    idKind: 'search',
    costHint: 'multi-hop',
    priorMs: 3500,
    strongFor: { languages: ['ta', 'te', 'ml', 'kn'] },
    trust: 'scraper',
    languagesOnly: true
  } satisfies SourceManifest;

  async extract(params: ExtractParams): Promise<ExtractedStream | null> {
    const { id: tmdbId, type, title, originalTitle, year, signal } = params;
    if (signal?.aborted) return null;
    const rawQuery = title || originalTitle;
    if (!rawQuery) return null;
    const query = rawQuery.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();

    const matched = await idMapper.map('isaimini', { tmdbId, type, title: query, originalTitle, year }, async (q: string) => {
      const cleanQ = q.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
      for (const base of [this.mainUrl, ...this.mirrors]) {
        try {
          const searchUrl = `${base}/search?q=${encodeURIComponent(cleanQ)}`;
          const html = await this.httpGet(searchUrl, { Referer: `${base}/` }, { signal, timeoutMs: 3500 });
          const items = parseIsaiminiSearch(html);
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
      const streamUrl = parseIsaiminiStream(pageHtml);
      if (!streamUrl) return null;
      const audios = detectSouthAudio(matched.title, streamUrl);

      const extracted: ExtractedStream = {
        url: streamUrl,
        format: formatOf(streamUrl, 'mp4'),
        headers: { Referer: `${this.mainUrl}/`, Origin: this.mainUrl },
        audios,
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
