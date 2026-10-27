// telegramExtractor.ts - Direct stream extractor for user's indexed Telegram channels
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';
import { telegramService } from '../services/telegramService.ts';

export class TelegramExtractor extends BaseExtractor {
  id = 'telegram';
  name = 'Telegram Private Channel';
  mainUrl = 'https://telegram.org';

  async extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
  }): Promise<ExtractedStream | null> {
    try {
      const auth = await telegramService.getAuthStatus();
      if (!auth.isLoggedIn) return null;

      const channels = await telegramService.getSelectedChannels();
      if (!channels || channels.length === 0) return null;

      if (!params.title) return null;

      const file = await telegramService.searchMediaInChannels(
        params.title,
        params.season,
        params.episode
      );

      if (!file) return null;

      const streamUrl = await telegramService.getStreamUrlForFile(file);
      if (!streamUrl) return null;

      const qualityMatch = file.fileName.match(/(2160|1440|1080|720|480|360)p?/i);

      return {
        url: streamUrl,
        format: file.fileName.toLowerCase().endsWith('.m3u8') ? 'hls' : 'mp4',
        quality: qualityMatch ? `${qualityMatch[1]}p` : '1080p'
      };
    } catch (err) {
      console.warn('[TelegramExtractor] Extraction error:', err);
      return null;
    }
  }
}
