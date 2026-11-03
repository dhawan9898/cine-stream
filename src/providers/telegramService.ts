// telegramService.ts - On-device Telegram MTProto client service for CineStream
import { TelegramClient, Api } from 'telegram';
import { errorMessage, toNumber } from 'streamkit/core/errors.ts';
import { StringSession } from 'telegram/sessions/index.js';
import type { EntityLike } from 'telegram/define';
import { Preferences } from '@capacitor/preferences';
import {
  SESSION_KEY,
  SELECTED_CHANNELS_KEY,
  clearCachedAuthStatus,
  hasSavedSession as readHasSavedSession,
  getSelectedChannels as readSelectedChannels,
  saveSelectedChannels as writeSelectedChannels
} from './telegramSession.ts';

const API_CREDENTIALS_KEY = 'telegram_api_credentials';

// Standard default Telegram API credentials (can be customized in settings if needed)
const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = 'b18441a1ed60921200021619a311827d';

export interface TelegramChannelInfo {
  id: string;
  title: string;
  username?: string;
  accessHash?: string;
}

export interface TelegramMediaFile {
  id: number;
  channelId: string;
  accessHash?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration?: number;
  media: Api.MessageMediaDocument;
}

class TelegramService {
  private client: TelegramClient | null = null;
  private currentSessionString: string = '';

  private async getApiCredentials(): Promise<{ apiId: number; apiHash: string }> {
    const { value } = await Preferences.get({ key: API_CREDENTIALS_KEY });
    if (value) {
      try {
        const parsed = JSON.parse(value);
        if (parsed.apiId && parsed.apiHash) return parsed;
      } catch {
        /* fallback to defaults */
      }
    }
    return { apiId: DEFAULT_API_ID, apiHash: DEFAULT_API_HASH };
  }

  public async setApiCredentials(apiId: number, apiHash: string): Promise<void> {
    await Preferences.set({ key: API_CREDENTIALS_KEY, value: JSON.stringify({ apiId, apiHash }) });
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }

  public hasSavedSession(): Promise<boolean> {
    return readHasSavedSession();
  }

  private async initClient(): Promise<TelegramClient> {
    if (this.client && this.client.connected) return this.client;

    const { apiId, apiHash } = await this.getApiCredentials();
    const { value } = await Preferences.get({ key: SESSION_KEY });
    this.currentSessionString = value || '';

    try {
      const stringSession = new StringSession(this.currentSessionString);
      const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 3,
        useWSS: true
      });

      await client.connect();
      this.client = client;
      return this.client;
    } catch (err) {
      this.client = null;
      throw err;
    }
  }

  public async getAuthStatus(): Promise<{
    isLoggedIn: boolean;
    username?: string;
    firstName?: string;
    phone?: string;
  }> {
    try {
      // Fast check: avoid connecting to Telegram if user hasn't saved a session
      const hasSession = await this.hasSavedSession();
      if (!hasSession) {
        return { isLoggedIn: false };
      }

      const client = await this.initClient();
      const me = await client.getMe();
      if (me && 'username' in me) {
        return {
          isLoggedIn: true,
          username: me.username || undefined,
          firstName: me.firstName || undefined,
          phone: me.phone || undefined
        };
      }
      return { isLoggedIn: false };
    } catch {
      return { isLoggedIn: false };
    }
  }

  public async sendAuthCode(phone: string): Promise<{ phoneCodeHash: string }> {
    const client = await this.initClient();
    const { apiId, apiHash } = await this.getApiCredentials();

    const result = await client.sendCode(
      { apiId, apiHash },
      phone
    );

    return { phoneCodeHash: result.phoneCodeHash };
  }

  public async signIn(
    phone: string,
    phoneCodeHash: string,
    code: string,
    password?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const client = await this.initClient();

      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash,
          phoneCode: code
        })
      );

      // Save session after successful sign in
      const sessionString = (client.session as StringSession).save();
      await Preferences.set({ key: SESSION_KEY, value: sessionString });
      this.currentSessionString = sessionString;

      return { success: true };
    } catch (err: unknown) {
      if (errorMessage(err, '').includes('SESSION_PASSWORD_NEEDED') && password) {
        try {
          const client = await this.initClient();
          const credentials = await this.getApiCredentials();
          await client.signInWithPassword(
            { apiId: credentials.apiId, apiHash: credentials.apiHash },
            { password: async () => password, onError: (e) => console.warn('2FA Error:', e) }
          );

          const sessionString = (client.session as StringSession).save();
          await Preferences.set({ key: SESSION_KEY, value: sessionString });
          this.currentSessionString = sessionString;

          return { success: true };
        } catch (pwdErr: unknown) {
          return { success: false, error: errorMessage(pwdErr, 'Invalid 2FA password') };
        }
      }
      return { success: false, error: errorMessage(err, 'Authentication failed') };
    }
  }

  public async logout(): Promise<void> {
    try {
      if (this.client) {
        await this.client.invoke(new Api.auth.LogOut());
        await this.client.disconnect();
        this.client = null;
      }
    } catch {
      /* ignore disconnect errors */
    } finally {
      await Preferences.remove({ key: SESSION_KEY });
      await Preferences.remove({ key: SELECTED_CHANNELS_KEY });
      await clearCachedAuthStatus();
      this.currentSessionString = '';
    }
  }

  public async getUserChannels(): Promise<TelegramChannelInfo[]> {
    try {
      const client = await this.initClient();
      const dialogs = await client.getDialogs({});

      const channels: TelegramChannelInfo[] = [];
      for (const dialog of dialogs) {
        if (dialog.id && (dialog.isChannel || dialog.isGroup)) {
          const entity = dialog.entity;
          if (entity && 'title' in entity) {
            channels.push({
              id: dialog.id.toString(),
              title: entity.title,
              username: 'username' in entity ? entity.username || undefined : undefined,
              accessHash: 'accessHash' in entity ? entity.accessHash?.toString() : undefined
            });
          }
        }
      }
      return channels;
    } catch (err) {
      console.warn('[TelegramService] Failed to fetch channels:', err);
      return [];
    }
  }

  public getSelectedChannels(): Promise<string[]> {
    return readSelectedChannels();
  }

  public saveSelectedChannels(channelIds: string[]): Promise<void> {
    return writeSelectedChannels(channelIds);
  }

  public async searchMediaInChannels(
    title: string,
    season?: number,
    episode?: number
  ): Promise<TelegramMediaFile | null> {
    try {
      const selectedChannelIds = await this.getSelectedChannels();
      if (selectedChannelIds.length === 0) return null;

      const client = await this.initClient();

      // Formulate search terms
      const searchTerms: string[] = [];
      if (season !== undefined && episode !== undefined) {
        const s = season.toString().padStart(2, '0');
        const e = episode.toString().padStart(2, '0');
        searchTerms.push(`${title} S${s}E${e}`, `${title} S${season}E${episode}`, `${title} ${season}x${episode}`);
      } else {
        searchTerms.push(title);
      }

      for (const channelId of selectedChannelIds) {
        for (const query of searchTerms) {
          try {
            // Resolve entity to ensure valid InputPeer with accessHash
            let peer: EntityLike = channelId;
            try {
              peer = await client.getEntity(channelId);
            } catch {
              // Fallback to raw identifier
              peer = channelId;
            }

            const messages = await client.getMessages(peer, {
              search: query,
              limit: 10,
              filter: new Api.InputMessagesFilterDocument()
            });

            for (const msg of messages) {
              if (msg.media && msg.media instanceof Api.MessageMediaDocument && msg.media.document) {
                const doc = msg.media.document as Api.Document;
                let fileName = 'video.mp4';
                let mimeType = doc.mimeType || 'video/mp4';

                for (const attr of doc.attributes) {
                  if (attr instanceof Api.DocumentAttributeFilename) {
                    fileName = attr.fileName;
                  }
                }

                // Check if file is a video or playable media format
                if (mimeType.startsWith('video/') || /\.(mp4|mkv|avi|mov|webm|m3u8|001)$/i.test(fileName)) {
                  const docIdNum = toNumber(doc.id);
                  const docSizeNum = toNumber(doc.size);

                  return {
                    id: docIdNum,
                    channelId,
                    fileName,
                    fileSize: docSizeNum,
                    mimeType,
                    media: msg.media
                  };
                }
              }
            }
          } catch (channelErr) {
            console.warn(`[TelegramService] Error searching channel ${channelId}:`, channelErr);
          }
        }
      }
      return null;
    } catch (err) {
      console.warn('[TelegramService] Search failed:', err);
      return null;
    }
  }

  public async getStreamUrlForFile(file: TelegramMediaFile): Promise<string | null> {
    try {
      const client = await this.initClient();

      // Download file bytes as a Blob URL with a 15-second safety timeout
      const downloadPromise = client.downloadMedia(file.media, {
        progressCallback: () => {}
      });

      const buffer = await Promise.race([
        downloadPromise,
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Download timeout')), 15000))
      ]);

      if (!buffer || typeof buffer === 'string') return null;

      const blob = new Blob([buffer as unknown as BlobPart], { type: file.mimeType || 'video/mp4' });
      return URL.createObjectURL(blob);
    } catch (err) {
      console.warn('[TelegramService] Stream resolution error:', err);
      return null;
    }
  }
}

export const telegramService = new TelegramService();
