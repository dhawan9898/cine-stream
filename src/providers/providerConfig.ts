// providerConfig.ts - Provider settings that can change without an app release.
//
// A small JSON file, fetched at launch from VITE_PROVIDER_CONFIG_URL (when set) and saved, lets
// the app: turn a provider off (kill switch), move it to a new host or mirror list, give it a
// head start in the ranking, and add providers that are plain JSON APIs (see apiExtractor.ts).
// The last good copy is kept, so the app still starts offline, and everything is validated:
// https only, no credentials in URLs, bounded sizes. A bad file is ignored as a whole.
//
//   {
//     "version": 1,
//     "providers": { "vega": { "enabled": false }, "flixeo": { "mainUrl": "https://example.tv" } },
//     "apiProviders": [ { "id": "mysource", "name": "My Source",
//         "movieUrl": "https://api.example.com/movie/{tmdbId}",
//         "tvUrl": "https://api.example.com/tv/{tmdbId}/{season}/{episode}",
//         "streamPath": "data.sources.0.url" } ]
//   }

export interface ProviderOverride {
  enabled?: boolean;
  mainUrl?: string;
  mirrors?: string[];
  /** Ms of expected time taken off this provider when ranking (positive = preferred). */
  bias?: number;
}

export interface ApiProviderSpec {
  id: string;
  name: string;
  /** URL templates; {tmdbId} {season} {episode} are filled in. */
  movieUrl: string;
  tvUrl?: string;
  /** Dot path to the stream URL in the JSON answer, e.g. "data.sources.0.url". */
  streamPath: string;
  /** Request headers (e.g. the user's own API key for a source they are licensed to use). */
  headers?: Record<string, string>;
  /** Headers the player must send with the stream request. */
  streamHeaders?: Record<string, string>;
  format?: 'hls' | 'dash' | 'mp4';
}

/**
 * A link resolver that is a third-party service (e.g. the decrypt API lobster uses for FlixHQ embeds).
 * The config can repoint it or switch it off for everyone; it can never switch it on for a viewer who
 * turned it off.
 */
export interface ResolverOverride {
  enabled?: boolean;
  endpoints?: string[];
}

export interface ProviderConfig {
  version: number;
  providers: Record<string, ProviderOverride>;
  apiProviders: ApiProviderSpec[];
  resolvers?: Record<string, ResolverOverride>;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = { version: 0, providers: {}, apiProviders: [], resolvers: {} };

const STORAGE_KEY = 'cinestream_provider_config_v1';
const REFRESH_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_MIRRORS = 6;
const MAX_API_PROVIDERS = 10;

/** https URL without credentials, or undefined. */
export function safeUrl(value: unknown, allowTemplate = false): string | undefined {
  if (typeof value !== 'string' || value.length > 500) return undefined;
  try {
    const probe = allowTemplate ? value.replace(/\{(tmdbId|season|episode)\}/g, '1') : value;
    const u = new URL(probe);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return undefined;
    return value.replace(/\/+$/, '') === value ? value : value.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function cleanHeaders(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v).slice(0, 10)) {
    if (/^[A-Za-z0-9-]{1,40}$/.test(k) && typeof val === 'string' && val.length <= 400) out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Validates a parsed file. Returns null when it is not usable at all. */
export function parseProviderConfig(raw: unknown): ProviderConfig | null {
  if (!isRecord(raw) || typeof raw.version !== 'number') return null;
  const providers: Record<string, ProviderOverride> = {};
  if (isRecord(raw.providers)) {
    for (const [id, v] of Object.entries(raw.providers)) {
      if (!ID_RE.test(id) || !isRecord(v)) continue;
      const o: ProviderOverride = {};
      if (typeof v.enabled === 'boolean') o.enabled = v.enabled;
      const main = safeUrl(v.mainUrl);
      if (main) o.mainUrl = main;
      if (Array.isArray(v.mirrors)) {
        const mirrors = v.mirrors.map(m => safeUrl(m)).filter((m): m is string => !!m).slice(0, MAX_MIRRORS);
        if (mirrors.length) o.mirrors = mirrors;
      }
      if (typeof v.bias === 'number' && isFinite(v.bias)) o.bias = Math.max(-5000, Math.min(5000, v.bias));
      providers[id] = o;
    }
  }
  const apiProviders: ApiProviderSpec[] = [];
  if (Array.isArray(raw.apiProviders)) {
    for (const a of raw.apiProviders.slice(0, MAX_API_PROVIDERS)) {
      if (!isRecord(a) || typeof a.id !== 'string' || !ID_RE.test(a.id) || typeof a.name !== 'string' || a.name.length > 60) continue;
      const movieUrl = safeUrl(a.movieUrl, true);
      const tvUrl = a.tvUrl === undefined ? undefined : safeUrl(a.tvUrl, true);
      if (!movieUrl || (a.tvUrl !== undefined && !tvUrl)) continue;
      if (typeof a.streamPath !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(a.streamPath)) continue;
      const format = a.format === 'dash' || a.format === 'mp4' || a.format === 'hls' ? a.format : undefined;
      apiProviders.push({
        id: a.id, name: a.name, movieUrl, tvUrl, streamPath: a.streamPath,
        headers: cleanHeaders(a.headers), streamHeaders: cleanHeaders(a.streamHeaders), format
      });
    }
  }
  const resolvers: Record<string, ResolverOverride> = {};
  if (isRecord(raw.resolvers)) {
    for (const [id, v] of Object.entries(raw.resolvers)) {
      if (!ID_RE.test(id) || !isRecord(v)) continue;
      const o: ResolverOverride = {};
      if (typeof v.enabled === 'boolean') o.enabled = v.enabled;
      if (Array.isArray(v.endpoints)) {
        const endpoints = v.endpoints.map(m => safeUrl(m)).filter((m): m is string => !!m).slice(0, MAX_MIRRORS);
        if (endpoints.length) o.endpoints = endpoints;
      }
      resolvers[id] = o;
    }
  }
  return { version: raw.version, providers, apiProviders, resolvers };
}

// ---- state ----------------------------------------------------------------------------

let current: ProviderConfig = DEFAULT_PROVIDER_CONFIG;
const listeners = new Set<(c: ProviderConfig) => void>();

function loadSaved(): { config: ProviderConfig; fetchedAt: number } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const config = saved ? parseProviderConfig(saved.config) : null;
    return config ? { config, fetchedAt: Number(saved.fetchedAt) || 0 } : null;
  } catch {
    return null;
  }
}

function apply(config: ProviderConfig): void {
  current = config;
  listeners.forEach(l => { try { l(config); } catch { /* a listener must not break the others */ } });
}

export function getProviderConfig(): ProviderConfig { return current; }
export function getProviderOverride(id: string): ProviderOverride | undefined { return current.providers[id]; }
export function isProviderEnabled(id: string): boolean { return current.providers[id]?.enabled !== false; }
export function getResolverOverride(id: string): ResolverOverride | undefined { return current.resolvers?.[id]; }

/** Called with the config now, and again whenever a newer one is loaded. */
export function subscribeProviderConfig(fn: (c: ProviderConfig) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => { listeners.delete(fn); };
}

/** Installs a config directly (used by tests and by the loader). */
export function setProviderConfig(config: ProviderConfig): void { apply(config); }

/**
 * Loads the saved config at once, then refreshes from `url` when it is set and the saved copy is
 * older than a few hours. Never throws; a failed or invalid download leaves the saved copy in use.
 */
export async function loadProviderConfig(url: string | undefined = configUrl(), fetchImpl: typeof fetch = fetch): Promise<void> {
  const saved = loadSaved();
  if (saved) apply(saved.config);
  const endpoint = safeUrl(url);
  if (!endpoint) return;
  if (saved && Date.now() - saved.fetchedAt < REFRESH_MS) return;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetchImpl(endpoint, { signal: ctl.signal, cache: 'no-store' }).finally(() => clearTimeout(timer));
    if (!res.ok) return;
    const config = parseProviderConfig(await res.json());
    if (!config) return;
    // An older file never replaces a newer saved one.
    if (saved && config.version < saved.config.version) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ config, fetchedAt: Date.now() })); } catch { /* storage unavailable */ }
    apply(config);
  } catch {
    /* offline or unreachable: keep what we have */
  }
}

function configUrl(): string | undefined {
  return typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env.VITE_PROVIDER_CONFIG_URL as string | undefined) : undefined;
}
