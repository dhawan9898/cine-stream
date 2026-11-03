// themeService.ts - CineStream's theme manager, built on the shared theme store.
import { createThemeStore } from 'streamkit/core/theme.ts';

export type Theme = 'dark' | 'obsidian' | 'slate' | 'light';

const store = createThemeStore<Theme>({
  key: 'cinestream_theme',
  // index.html reads this key before first paint.
  syncKey: 'cinestream_theme',
  themes: ['dark', 'obsidian', 'slate', 'light'],
  fallback: 'dark'
});

export const getSavedTheme = store.getSync;

export function applyTheme(theme: Theme): void {
  store.apply(theme);
  void store.set(theme).catch(() => undefined);
}
