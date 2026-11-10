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
  serverId?: string;
  serverName?: string;
}

export interface StreamExtractor {
  id: string;
  name: string;
  mainUrl: string;
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
