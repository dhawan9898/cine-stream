// nativePlayer.ts - TypeScript Capacitor Plugin bridge for Native Media3 ExoPlayer
import { Capacitor } from '@capacitor/core';
import { ExoPlayerPlugin, type PlayOptions } from '../plugins/exoPlayerPlugin.ts';

export async function openNativeExoPlayer(options: PlayOptions): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    console.info('[NativePlayer] Web platform detected; using WebPlayer / iframe fallback.');
    return false;
  }

  try {
    const res = await ExoPlayerPlugin.play(options);
    return res?.success ?? true;
  } catch (err) {
    console.warn('[NativePlayer] Native ExoPlayer plugin error:', err);
    return false;
  }
}
