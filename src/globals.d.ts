declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_TMDB_API_KEY?: string;
  readonly VITE_USE_TMDB_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv & Record<string, any>;
}
