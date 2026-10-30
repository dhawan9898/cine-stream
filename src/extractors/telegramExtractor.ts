// telegramExtractor.ts - Direct stream extractor for user's indexed Telegram channels
import { Preferences } from '@capacitor/preferences';
import { BaseExtractor } from './baseExtractor.ts';
import type { ExtractedStream } from './types.ts';

const SESSION_KEY = 'telegram_session_string';

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
      // 1. Instant check: if running outside browser/WebView or user has no saved Telegram session, skip immediately (0ms)
      if (typeof window === 'undefined') {
        return null;
      }

      const { value: session } = await Preferences.get({ key: SESSION_KEY });
      if (!session || !session.trim()) {
        return null;
      }

      if (!params.title) return null;

      // 2. Lazily load telegramService so the heavy Telegram client bundle is not in the critical path
      const { telegramService } = await import('../services/telegramService.ts');

      const channels = await telegramService.getSelectedChannels();
      if (!channels || channels.length === 0) return null;

      const auth = await telegramService.getAuthStatus();
      if (!auth.isLoggedIn) return null;

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
