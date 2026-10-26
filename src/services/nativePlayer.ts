// nativePlayer.ts - TypeScript Capacitor Plugin bridge for Native Media3 ExoPlayer
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativePlayerPluginInterface {
  openPlayer(options: {
    videoUrl: string;
    title?: string;
    headers?: Record<string, string>;
  }): Promise<void>;
}

const NativePlayer = registerPlugin<NativePlayerPluginInterface>('NativePlayer');

export async function openNativeExoPlayer(params: {
  videoUrl: string;
  title?: string;
  headers?: Record<string, string>;
}): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    console.info('[NativePlayer] Web platform detected; using HTML5 / hls.js player fallback.');
    return false;
  }

  try {
    await NativePlayer.openPlayer({
      videoUrl: params.videoUrl,
      title: params.title || 'CineStream Native',
      headers: params.headers || {}
    });
    return true;
  } catch (err) {
    console.warn('[NativePlayer] Native player plugin error:', err);
    return false;
  }
}
