// streamResolver.ts - CineStream multi-source streaming provider engine
import type { MediaType } from '../core/cineHypeCore.ts';

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

// Sample high-quality adaptive HLS streams for Native Netflix player testing
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

export function resolveStreamUrl(params: StreamParams): string {
  const { id, type, season = 1, episode = 1, server = 'native' } = params;
  const isSeries = type === 'tv';

  switch (server) {
    case 'native': {
      return NATIVE_HLS_STREAMS[0].url;
    }

    case 'vidsrc': {
      if (isSeries) {
        return `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`;
      }
      return `https://vidsrc.to/embed/movie/${id}`;
    }

    case 'vidsrcme': {
      if (isSeries) {
        return `https://vidsrc.me/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`;
      }
      return `https://vidsrc.me/embed/movie?tmdb=${id}`;
    }

    case 'autoembed': {
      if (isSeries) {
        return `https://autoembed.co/tv/tmdb/${id}-${season}-${episode}`;
      }
      return `https://autoembed.co/movie/tmdb/${id}`;
    }

    case 'twoembed': {
      if (isSeries) {
        return `https://2embed.cc/embedtv/${id}&s=${season}&e=${episode}`;
      }
      return `https://2embed.cc/embed/${id}`;
    }

    case 'vidfast': {
      if (isSeries) {
        return `https://vidfast.vc/tv/${id}/${season}/${episode}?autoPlay=true&theme=ec1c24&nextButton=true`;
      }
      return `https://vidfast.vc/movie/${id}?autoPlay=true&theme=ec1c24`;
    }

    case 'vidlink': {
      if (isSeries) {
        return `https://vidlink.pro/tv/${id}/${season}/${episode}?primaryColor=ec1c24&secondaryColor=ff3344&autoplay=true`;
      }
      return `https://vidlink.pro/movie/${id}?primaryColor=ec1c24&secondaryColor=ff3344&autoplay=true`;
    }

    case 'vaplayer': {
      if (isSeries) {
        return `https://vaplayer.ru/embed/tv/${id}/${season}/${episode}`;
      }
      return `https://vaplayer.ru/embed/movie/${id}`;
    }

    default: {
      if (isSeries) {
        return `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`;
      }
      return `https://vidsrc.to/embed/movie/${id}`;
    }
  }
}
