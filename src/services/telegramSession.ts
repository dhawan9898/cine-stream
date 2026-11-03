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

// The account label shown in Settings. Reading it live means connecting the
// whole Telegram client, so the last known value is kept for a day and only
// refreshed on login / logout or once stale.
const AUTH_STATUS_KEY = 'telegram_auth_status';
const AUTH_STATUS_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedAuthStatus {
  isLoggedIn: boolean;
  username?: string;
  firstName?: string;
  phone?: string;
}

export async function getCachedAuthStatus(now = Date.now()): Promise<CachedAuthStatus | null> {
  const { value } = await Preferences.get({ key: AUTH_STATUS_KEY });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { at?: number; status?: CachedAuthStatus };
    if (typeof parsed.at !== 'number' || !parsed.status || now - parsed.at > AUTH_STATUS_TTL_MS) return null;
    return parsed.status;
  } catch {
    return null;
  }
}

export async function saveCachedAuthStatus(status: CachedAuthStatus): Promise<void> {
  await Preferences.set({ key: AUTH_STATUS_KEY, value: JSON.stringify({ at: Date.now(), status }) });
}

export async function clearCachedAuthStatus(): Promise<void> {
  await Preferences.remove({ key: AUTH_STATUS_KEY });
}
