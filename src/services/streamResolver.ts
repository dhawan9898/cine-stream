// streamResolver.ts - Multi-source video stream resolution engine with direct extractor & embed fallback
import type { MediaType } from '../core/cineHypeCore.ts';
import { extractorRegistry } from '../extractors/extractorRegistry.ts';
import type { ExtractedStream } from '../extractors/types.ts';

export interface StreamServer {
  id: string;
  name: string;
  badge: string;
  speed: 'Ultra Fast' | 'Fast' | 'Standard';
  description: string;
  isNative?: boolean;
}

export const STREAM_SERVERS: StreamServer[] = [
  {
    id: 'native',
    name: 'CineStream Native HLS',
    badge: 'Netflix Engine',
    speed: 'Ultra Fast',
    description: 'Hardware accelerated native HTML5/HLS player with Netflix UI, scrubbing & multi-audio (0 Pop-ups)',
    isNative: true
  },
  {
    id: 'vidsrc',
    name: 'VidSrc TO',
    badge: 'Recommended',
    speed: 'Ultra Fast',
    description: 'High-definition 1080p mirror with high uptime and multi-audio tracks'
  },
  {
    id: 'vidsrcme',
    name: 'VidSrc ME',
    badge: 'HD Mirror',
    speed: 'Fast',
    description: 'Direct multi-lingual mirror with subtitle tracks'
  },
  {
    id: 'autoembed',
    name: 'AutoEmbed CDN',
    badge: 'Global CDN',
    speed: 'Fast',
    description: 'Worldwide CDN with automatic fallback switching'
  },
  {
    id: 'twoembed',
    name: '2Embed CC',
    badge: 'Multi-Sub',
    speed: 'Fast',
    description: 'Reliable multi-server cluster with automatic resolution adjustment'
  },
  {
    id: 'vidfast',
    name: 'VidFast VC',
    badge: 'CineHype Core',
    speed: 'Fast',
    description: 'Native CineHype provider with instant buffering & auto-play'
  },
  {
    id: 'vidlink',
    name: 'VidLink PRO',
    badge: 'HD Stream',
    speed: 'Ultra Fast',
    description: 'Next-gen streaming provider with multi-subtitle & fast buffering'
  },
  {
    id: 'vaplayer',
    name: 'VaPlayer RU',
    badge: 'Backup',
    speed: 'Standard',
    description: 'Alternative mirror for recent releases & trending shows'
  }
];

export interface StreamParams {
  id: number;
  type: MediaType;
  season?: number;
  episode?: number;
  server?: string;
}

export interface ResolvedStream extends ExtractedStream {
  serverId: string;
  serverName: string;
}

export const NATIVE_HLS_STREAMS = [
  {
    title: 'Adaptive Multi-Bitrate 1080p (Tears of Steel)',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
  },
  {
    title: 'Big Buck Bunny 4K/60fps HLS Stream',
    url: 'https://cdn.jwplayer.com/manifests/pZxKAyNO.m3u8'
  },
  {
    title: 'Sintel Open Movie HD Stream',
    url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8'
  }
];

export function resolveFallbackEmbedUrl(params: StreamParams): string {
  const { id, type, season = 1, episode = 1, server = 'vidsrc' } = params;
  const isSeries = type === 'tv';

  switch (server) {
    case 'native':
      return NATIVE_HLS_STREAMS[0].url;
    case 'vidsrc':
      return isSeries
        ? `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`
        : `https://vidsrc.to/embed/movie/${id}`;
    case 'vidsrcme':
      return isSeries
        ? `https://vidsrc.me/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`
        : `https://vidsrc.me/embed/movie?tmdb=${id}`;
    case 'autoembed':
      return isSeries
        ? `https://autoembed.co/tv/tmdb/${id}-${season}-${episode}`
        : `https://autoembed.co/movie/tmdb/${id}`;
    case 'twoembed':
      return isSeries
        ? `https://2embed.cc/embedtv/${id}&s=${season}&e=${episode}`
        : `https://2embed.cc/embed/${id}`;
    case 'vidfast':
      return isSeries
        ? `https://vidfast.vc/tv/${id}/${season}/${episode}?autoPlay=true&theme=ec1c24&nextButton=true`
        : `https://vidfast.vc/movie/${id}?autoPlay=true&theme=ec1c24`;
    case 'vidlink':
      return isSeries
        ? `https://vidlink.pro/tv/${id}/${season}/${episode}?primaryColor=ec1c24&secondaryColor=ff3344&autoplay=true`
        : `https://vidlink.pro/movie/${id}?primaryColor=ec1c24&secondaryColor=ff3344&autoplay=true`;
    case 'vaplayer':
      return isSeries
        ? `https://vaplayer.ru/embed/tv/${id}/${season}/${episode}`
        : `https://vaplayer.ru/embed/movie/${id}`;
    default:
      return isSeries
        ? `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`
        : `https://vidsrc.to/embed/movie/${id}`;
  }
}

const cache = new Map<string, { at: number; promise: Promise<ResolvedStream> }>();
const REUSE_MS = 4 * 60 * 1000;
const keyOf = (p: StreamParams) => `${p.type}|${p.id}|${p.season ?? 0}|${p.episode ?? 0}|${p.server ?? ''}`;

async function resolveUncached(params: StreamParams): Promise<ResolvedStream> {
  const targetServerId = params.server || 'native';
  const serverObj = STREAM_SERVERS.find(s => s.id === targetServerId) || STREAM_SERVERS[0];

  if (targetServerId === 'native') {
    return {
      url: NATIVE_HLS_STREAMS[0].url,
      format: 'hls',
      serverId: 'native',
      serverName: 'CineStream Native HLS'
    };
  }

  // Attempt direct stream extraction first
  try {
    const extracted = await extractorRegistry.resolveStream(targetServerId, {
      id: params.id,
      type: params.type,
      season: params.season,
      episode: params.episode
    });

    if (extracted && extracted.url && !extracted.isFallbackEmbed) {
      return {
        ...extracted,
        serverId: serverObj.id,
        serverName: serverObj.name
      };
    }
  } catch (err) {
    console.warn(`[StreamResolver] Direct extraction failed for ${targetServerId}:`, err);
  }

  // Fallback to provider embed URL
  const embedUrl = resolveFallbackEmbedUrl({ ...params, server: targetServerId });
  return {
    url: embedUrl,
    format: 'hls',
    isFallbackEmbed: true,
    serverId: serverObj.id,
    serverName: serverObj.name
  };
}

export function resolveStream(params: StreamParams, options: { fresh?: boolean } = {}): Promise<ResolvedStream> {
  const key = keyOf(params);
  const existing = cache.get(key);
  if (!options.fresh && existing && Date.now() - existing.at < REUSE_MS) {
    return existing.promise.then(s => ({ ...s }));
  }

  const entry = { at: Date.now(), promise: resolveUncached(params) };
  cache.set(key, entry);
  entry.promise.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });

  return entry.promise.then(s => ({ ...s }));
}
