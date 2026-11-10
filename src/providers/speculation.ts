// speculation.ts - Whether the app may resolve streams in the background that nobody has asked for yet.
//
// Speculative lookups sniff embed pages in a hidden WebView, which costs data, battery and CPU.
// They run on Wi-Fi and on mobile data alike, unless the viewer turned Faster Start off or Data
// Saver on, the phone itself is in data-saving mode, or the battery is low. Otherwise they need the
// app on screen with nothing playing - except the next episode of what is playing, which is
// prepared during playback so it starts at once. Anything unknown is treated as allowed.
import { Capacitor } from '@capacitor/core';
import { getUserPreferences } from '../services/historyService.ts';
import { isStreamPlaying } from './streamRevalidator.ts';

const LOW_BATTERY = 0.2;

interface BatteryLike { level: number; charging: boolean; addEventListener: (e: string, cb: () => void) => void }
let battery: { level: number; charging: boolean } | null = null;

/** Starts tracking the battery where the platform exposes it. Safe to call more than once. */
export function initSpeculation(): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  if (!nav.getBattery || battery) return;
  nav.getBattery().then(b => {
    const read = () => { battery = { level: b.level, charging: b.charging }; };
    read();
    b.addEventListener('levelchange', read);
    b.addEventListener('chargingchange', read);
  }).catch(() => undefined);
}

export interface SpeculationInputs {
  native: boolean;
  visible: boolean;
  playing: boolean;
  preloadStreams: boolean;
  dataSaver: boolean;
  metered: boolean;
  saveData: boolean;
  battery: { level: number; charging: boolean } | null;
  /** The next episode of what is playing: allowed while the player is open (and covers the app). */
  nextEpisode?: boolean;
}

/** The decision, separate from where its inputs come from (so it can be tested). */
export function decide(i: SpeculationInputs): boolean {
  if (!i.native) return false;
  if (!i.nextEpisode && (!i.visible || i.playing)) return false;
  if (!i.preloadStreams || i.dataSaver) return false;
  // Mobile data is fine (i.metered); only the phone's own data-saving mode stops it.
  if (i.saveData) return false;
  if (i.battery && !i.battery.charging && i.battery.level < LOW_BATTERY) return false;
  return true;
}

export function speculationAllowed(opts: { nextEpisode?: boolean } = {}): boolean {
  const prefs = getUserPreferences();
  const conn = (typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection : undefined);
  return decide({
    native: Capacitor.isNativePlatform(),
    visible: typeof document === 'undefined' || document.visibilityState === 'visible',
    playing: isStreamPlaying(),
    preloadStreams: prefs.preloadStreams,
    dataSaver: prefs.dataSaver,
    metered: conn?.type === 'cellular',
    saveData: Boolean(conn?.saveData),
    battery,
    nextEpisode: opts.nextEpisode
  });
}
