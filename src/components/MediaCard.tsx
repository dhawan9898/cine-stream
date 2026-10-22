// MediaCard.tsx - Poster card for movies and TV series
import React from 'react';
import { Star, Play } from 'lucide-react';
import type { MediaItem } from '../core/cineHypeCore.ts';
import { FadeImage } from './FadeImage.tsx';

interface MediaCardProps {
  media: MediaItem;
  onClick: () => void;
  width?: number | string;
  showBadge?: boolean;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  media,
  onClick,
  width = 150,
  showBadge = true
}) => {
  const year = media.releaseDate ? media.releaseDate.slice(0, 4) : '';

  return (
    <div
      onClick={onClick}
      className="poster-card interactive"
      style={{
        width,
        flex: typeof width === 'number' ? `0 0 ${width}px` : width,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div style={{ position: 'relative', width: '100%', aspectRatio: '2/3', overflow: 'hidden' }}>
        <FadeImage src={media.poster} alt={media.title} />

        {/* Top Badges */}
        {showBadge && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              right: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              pointerEvents: 'none'
            }}
          >
            <span
              className="badge"
              style={{
                background: media.mediaType === 'tv' ? 'var(--accent-secondary)' : 'var(--accent-primary)',
                color: '#fff',
                fontSize: '10px',
                padding: '2px 6px'
              }}
            >
              {media.mediaType.toUpperCase()}
            </span>

            {media.voteAverage > 0 && (
              <span className="badge badge-glass" style={{ fontSize: '10px', padding: '2px 6px', gap: '2px' }}>
                <Star size={10} fill="var(--accent-gold)" color="var(--accent-gold)" />
                {media.voteAverage}
              </span>
            )}
          </div>
        )}

        {/* Hover overlay with quick play icon */}
        <div
          className="play-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 60%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0,
            transition: 'opacity 0.2s ease'
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0'; }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'var(--accent-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--accent-glow)'
            }}
          >
            <Play size={20} fill="#fff" color="#fff" style={{ marginLeft: 3 }} />
          </div>
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '10px 8px 12px 8px' }}>
        <h4
          style={{
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: '4px'
          }}
          title={media.title}
        >
          {media.title}
        </h4>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
          <span>{year}</span>
          <span style={{ textTransform: 'capitalize' }}>{media.mediaType}</span>
        </div>
      </div>
    </div>
  );
};
