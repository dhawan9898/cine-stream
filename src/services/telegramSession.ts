// telegramSession.ts - Preferences-only Telegram state (saved session flag and
// selected channels). Deliberately free of the GramJS client so screens can read
// it without pulling the ~1.5 MB Telegram bundle into memory.
import { Preferences } from '@capacitor/preferences';

export const SESSION_KEY = 'telegram_session_string';
export const SELECTED_CHANNELS_KEY = 'telegram_selected_channels';

export async function hasSavedSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const { value } = await Preferences.get({ key: SESSION_KEY });
  return Boolean(value && value.trim().length > 0);
}

export async function getSelectedChannels(): Promise<string[]> {
  const { value } = await Preferences.get({ key: SELECTED_CHANNELS_KEY });
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveSelectedChannels(channelIds: string[]): Promise<void> {
  await Preferences.set({ key: SELECTED_CHANNELS_KEY, value: JSON.stringify(channelIds) });
}
