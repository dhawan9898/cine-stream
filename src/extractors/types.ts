// types.ts - Extractor contracts & data models for CineStream
export type StreamFormat = 'hls' | 'dash' | 'mp4';

export interface ExtractorSubtitle {
  url: string;
  lang: string;
  label: string;
  mimeType?: string;
}

export interface ExtractedStream {
  url: string;
  format: StreamFormat;
  quality?: string;
  headers?: Record<string, string>;
  subtitles?: ExtractorSubtitle[];
  isFallbackEmbed?: boolean;
}

export interface StreamExtractor {
  id: string;
  name: string;
  mainUrl: string;
  extract(params: {
    id: number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    title?: string;
  }): Promise<ExtractedStream | null>;
}
