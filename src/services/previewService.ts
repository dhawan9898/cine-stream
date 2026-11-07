// previewService.ts - Which title's long-press preview is open. Any poster
// can open it (PosterCard), and one QuickPreview rendered by App shows it.
import type { MediaItem } from '../providers/cineHypeCore.ts';

let current: MediaItem | null = null;
const listeners = new Set<() => void>();

export const getPreview = (): MediaItem | null => current;

export const subscribePreview = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

export function openPreview(media: MediaItem): void {
  current = media;
  listeners.forEach(fn => fn());
}

export function closePreview(): void {
  if (!current) return;
  current = null;
  listeners.forEach(fn => fn());
}
