// types.ts - Extractor contracts & data models for CineStream
export type StreamFormat = 'hls' | 'dash' | 'mp4';

export interface ExtractorSubtitle {
  url: string;
  lang: string;
  label: string;
  mimeType?: string;
}

export interface QualityVariant {
  quality: string;
  url: string;
}

// Another language of the same title, offered as a separate stream (multi-audio releases).
export interface AudioVariant {
  label: string;
  language: string;
  url: string;
  qualities?: QualityVariant[];
}

export interface ExtractedStream {
  url: string;
  format: StreamFormat;
  quality?: string;
  headers?: Record<string, string>;
  subtitles?: ExtractorSubtitle[];
  // Alternate renditions of this same stream (different resolution files).
  qualities?: QualityVariant[];
  // Other languages of this title; the player lists them under Audio.
  audios?: AudioVariant[];
  isFallbackEmbed?: boolean;
  /** A saved copy of this link is checked before playback once it was last confirmed this long ago (default: 15 min). Set for links that carry short-lived tokens. */
  revalidateAfterMs?: number;
  serverId?: string;
  serverName?: string;
}

/**
 * How a provider finds titles and what a lookup on it costs. The planner (extractorRegistry) ranks and
 * schedules providers from this plus what it has learned, instead of from hard-coded lists.
 * See docs/provider-architecture.md.
 */
export interface SourceManifest {
  /** What the provider needs to find a title: a TMDB id, or a title search on its own site. */
  idKind: 'tmdb' | 'search';
  /**
   * 'instant'/'api' providers start at once; 'multi-hop' and 'sniff' ones (several requests, or a
   * WebView) only after a hedge delay, or as soon as every cheap one has come up empty.
   */
  costHint: 'instant' | 'api' | 'multi-hop' | 'sniff';
  /** Expected ms to a playable stream before anything has been measured (seeds the ranking). */
  priorMs?: number;
  /** Ranked ahead (by PRIMARY_BIAS_MS) for titles of these kinds / original languages (ISO 639-1). */
  strongFor?: { kinds?: Array<'movie' | 'tv'>; languages?: string[] };
  /** Links carry short-lived tokens: a saved one is re-checked after this long (default 15 min). */
  linkTtlMs?: number;
  /** Fetch the first segment when validating (some lanes serve placeholder images as segments). */
  deepProbe?: boolean;
  /** Tie-break between equally fast providers: self-hosted beats api beats scraper. */
  trust?: 'self-hosted' | 'api' | 'scraper';
}

/** What a title lookup knows about the title, beyond its TMDB id (used by search-based sources). */
export interface ExtractParams {
  id: number;
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
  title?: string;
  /** Original-language title, a second search key for search-based sources. */
  originalTitle?: string;
  /** Release (or first-air) year, to tell remakes and same-named titles apart. */
  year?: number;
  language?: string;
  signal?: AbortSignal;
}

export interface StreamExtractor {
  id: string;
  name: string;
  mainUrl: string;
  /** Absent: treated as a TMDB-id API provider (see manifest.ts#manifestOf). */
  manifest?: SourceManifest;
  /** False when the provider cannot be used at all right now (e.g. a self-hosted server not set up). */
  available?(): boolean;
  /**
   * Every stream the provider found (servers, lanes), best first - direct streams and embed pages
   * (isFallbackEmbed) the registry may sniff. When present the registry uses it instead of extract(),
   * so the losers become alternates the player can fail over to.
   */
  extractAll?(params: ExtractParams): Promise<ExtractedStream[]>;
  /**
   * The provider's embed page for a title, known without any request. When present, the registry
   * starts sniffing it at once, in parallel with extract()'s own (static) attempt, instead of only
   * after that attempt gave up - the static attempt rarely finds a stream on script-built players.
   */
  embedUrl?(params: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number }): string | null;
  extract(params: ExtractParams): Promise<ExtractedStream | null>;
}

/** Another server's stream for the same title, handed to the player for local failover. */
export interface AlternateStream {
  url: string;
  format: StreamFormat;
  headers?: Record<string, string>;
  serverId?: string;
  serverName?: string;
}
