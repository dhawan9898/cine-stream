// streamResolver.ts - CineHype multi-source streaming provider engine
import type { MediaType } from '../core/cineHypeCore.ts';

export interface StreamServer {
  id: string;
  name: string;
  badge: string;
  speed: 'Ultra Fast' | 'Fast' | 'Standard';
  description: string;
}

export const STREAM_SERVERS: StreamServer[] = [
  {
    id: 'vidfast',
    name: 'VidFast',
    badge: 'CineHype Primary',
    speed: 'Ultra Fast',
    description: 'Native CineHype provider with instant buffering & auto-play'
  },
  {
    id: 'vsrc',
    name: 'VidSrc SU',
    badge: 'HD Mirror',
    speed: 'Fast',
    description: 'High-definition 1080p mirror with multiple audio tracks'
  },
  {
    id: 'rypr',
    name: 'VidSrc / Rypr',
    badge: 'Multi-Sub',
    speed: 'Fast',
    description: 'CineHype legacy engine with multilingual subtitles'
  },
  {
    id: 'screenfetch',
    name: 'ScreenFetch',
    badge: 'Direct Stream',
    speed: 'Fast',
    description: 'Fast streaming cluster with responsive scrubbing'
  },
  {
    id: 'vaplayer',
    name: 'VaPlayer',
    badge: 'Backup',
    speed: 'Standard',
    description: 'Alternative mirror for recent releases & trending shows'
  },
  {
    id: 'autoembed',
    name: 'AutoEmbed',
    badge: 'Global CDN',
    speed: 'Ultra Fast',
    description: 'Worldwide CDN with automatic fallback switching'
  }
];

export interface StreamParams {
  id: number;
  type: MediaType;
  season?: number;
  episode?: number;
  server?: string;
}

export function resolveStreamUrl(params: StreamParams): string {
  const { id, type, season = 1, episode = 1, server = 'vidfast' } = params;
  const isSeries = type === 'tv';

  switch (server) {
    case 'vidfast': {
      if (isSeries) {
        return `https://vidfast.vc/tv/${id}/${season}/${episode}?autoPlay=true&theme=ec1c24&nextButton=true`;
      }
      return `https://vidfast.vc/movie/${id}?autoPlay=true&theme=ec1c24`;
    }

    case 'vsrc': {
      if (isSeries) {
        return `https://vsrc.su/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`;
      }
      return `https://vsrc.su/embed/movie?tmdb=${id}`;
    }

    case 'rypr': {
      if (isSeries) {
        return `https://api.rypr.ru/embed/series/${id}?s=${season}&e=${episode}`;
      }
      return `https://vidsrc.me/embed/movie/${id}?v=3.2.0&n=CineHype`;
    }

    case 'screenfetch': {
      if (isSeries) {
        return `https://screenfetch4.cyou/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`;
      }
      return `https://screenfetch4.cyou/embed/movie?tmdb=${id}`;
    }

    case 'vaplayer': {
      if (isSeries) {
        return `https://vaplayer.ru/embed/tv/${id}/${season}/${episode}`;
      }
      return `https://vaplayer.ru/embed/movie/${id}`;
    }

    case 'autoembed': {
      if (isSeries) {
        return `https://player.autoembed.cc/embed/tv/${id}/${season}/${episode}`;
      }
      return `https://player.autoembed.cc/embed/movie/${id}`;
    }

    default: {
      return `https://vidfast.vc/movie/${id}?autoPlay=true&theme=ec1c24`;
    }
  }
}
