// hdhub4u.ts - HDHub4U Direct Stream Extractor
// Scrapes HDHub4U catalog for Hindi, South Indian Dubbed, and English titles.
// Unrolls HubCloud, PixelDrain, and StreamWish links into direct playable HLS/MP4 streams.
import { BaseExtractor } from './base.ts';
import type { ExtractedStream, ExtractParams, SourceManifest } from '../core/types.ts';
import { languagesIn } from '../core/language.ts';
import { formatOf, qualityRank } from './kunaiCommon.ts';
import { idMapper } from './idMapper.ts';

const DEFAULT_MAIN_URL = 'https://hdhub4u.store';
const MIRRORS = ['https://hdhub4u.tv', 'https://hdhub4u.org', 'https://hdhub4u.net'];

interface DirectLink {
  quality: string;
  url: string;
}

export function parseSearchCards(html: string): Array<{ title: string; year?: number; link: string }> {
  const cards: Array<{ title: string; year?: number; link: string }> = [];
  const regex = /<a\s+[^>]*href=["'](https?:\/\/[^"'\s]+\/(?:movie|tv|series|film)\/[^"'\s]+)["'][^>]*>(.*?)<\/a>/gis;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const link = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    if (!text || cards.some(c => c.link === link)) continue;
    const yearMatch = text.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
    cards.push({ title: text, year, link });
  }
  return cards;
}

export function parseStreamLinks(html: string): DirectLink[] {
  const links: DirectLink[] = [];
  const regex = /href=["'](https?:\/\/[^"'\s]+(?:hubcloud|pixeldrain|streamwish|fastdrive|filelions|m3u8|mp4)[^"'\s]*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const url = match[1];
    let quality = '720p';
    if (/1080p|1080/i.test(url) || /1080p|1080/i.test(html)) quality = '1080p';
    else if (/480p|480/i.test(url)) quality = '480p';
    else if (/2160p|4k/i.test(url)) quality = '4K';

    if (!links.some(l => l.url === url)) {
      links.push({ quality, url });
    }
  }
  return links;
}

export class HDHub4UExtractor extends BaseExtractor {
  id = 'hdhub4u';
  name = 'HDHub4U Direct';
  mainUrl = DEFAULT_MAIN_URL;
  private mirrors = [...MIRRORS];

  manifest = {
    idKind: 'search',
    costHint: 'multi-hop',
    priorMs: 3800,
    strongFor: { languages: ['hi', 'te', 'ta'] },
    trust: 'scraper',
    languagesOnly: true
  } satisfies SourceManifest;

  async extract(params: ExtractParams): Promise<ExtractedStream | null> {
    const { id: tmdbId, type, title, originalTitle, year, signal } = params;
    if (signal?.aborted) return null;
    const rawQuery = title || originalTitle;
    if (!rawQuery) return null;
    const query = rawQuery.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();

    const siteTitle = await idMapper.map('hdhub4u', { tmdbId, type, title: query, originalTitle, year }, async (q: string) => {
      const cleanQ = q.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
      for (const base of [this.mainUrl, ...this.mirrors]) {
        try {
          const searchUrl = `${base}/?s=${encodeURIComponent(cleanQ)}`;
          const html = await this.httpGet(searchUrl, { Referer: `${base}/` }, { signal, timeoutMs: 3500 });
          const parsed = parseSearchCards(html);
          if (parsed.length > 0) {
            return parsed.map(p => ({ siteId: p.link, title: p.title, year: p.year, type }));
          }
        } catch {
          // try next mirror
        }
      }
      return [];
    });

    if (!siteTitle?.siteId) return null;

    try {
      const pageHtml = await this.httpGet(siteTitle.siteId, { Referer: `${this.mainUrl}/` }, { signal, timeoutMs: 4000 });
      const foundLinks = parseStreamLinks(pageHtml);
      if (foundLinks.length === 0) return null;

      foundLinks.sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
      const primary = foundLinks[0];
      const format = formatOf(primary.url, 'hls');
      // The languages the release names ("Hindi + English" is one dual-audio file, not two choices);
      // none named stays unknown.
      const languages = languagesIn(siteTitle.title, query);

      const extracted: ExtractedStream = {
        url: primary.url,
        format,
        quality: primary.quality,
        headers: { Referer: `${this.mainUrl}/`, Origin: this.mainUrl },
        qualities: foundLinks,
        languages: languages.length > 0 ? languages : undefined,
        releaseName: siteTitle.title,
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
