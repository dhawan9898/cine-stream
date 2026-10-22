// themeService.ts - Theme manager for CineStream
export type Theme = 'dark' | 'obsidian' | 'slate' | 'light';

const THEME_KEY = 'cinestream_theme';

export function getSavedTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    return saved || 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme): void {
  try {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}
