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

export interface StreamExtractor {
  id: string;
  name: string;
  mainUrl: string;
  /**
   * 'primary' providers (the Kunai direct-API ones) run first, together; the others only start when
   * none of them has a stream yet after PRIMARY_HEAD_START_MS, or as soon as all of them came up empty.
   */
  tier?: 'primary';
  /**
   * The provider's embed page for a title, known without any request. When present, the registry
   * starts sniffing it at once, in parallel with extract()'s own (static) attempt, instead of only
   * after that attempt gave up - the static attempt rarely finds a stream on script-built players.
   */
  embedUrl?(params: { id: number; type: 'movie' | 'tv'; season?: number; episode?: number }): string | null;
  extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<ExtractedStream | null>;
}
