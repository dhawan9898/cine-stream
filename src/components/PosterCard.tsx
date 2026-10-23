// PosterCard.tsx - Compact poster tile used by the horizontal rails and the
// poster grids (browse pages, More Like This). Flat and opaque on purpose.
import React from 'react';
import type { MediaItem } from '../core/cineHypeCore.ts';
import { FadeImage } from './FadeImage.tsx';

interface PosterCardProps {
  media: MediaItem;
  onClick: () => void;
  // Fixed width for use inside a horizontal rail; omit to fill a grid cell
  // (grid cells also show the title underneath).
  width?: number;
  badge?: string;
}

export const PosterCard: React.FC<PosterCardProps> = ({ media, onClick, width, badge }) => (
  <div
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    }}
    role="button"
    tabIndex={0}
    aria-label={media.title}
    className="interactive"
    style={{
      flex: width ? `0 0 ${width}px` : undefined,
      width: width ? `${width}px` : '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }}
  >
    <div style={{
      position: 'relative',
      width: '100%',
      paddingTop: '145%',
      borderRadius: '6px',
      overflow: 'hidden',
      backgroundColor: 'rgba(127, 127, 127, 0.15)'
    }}>
      {media.poster && (
        <FadeImage
          src={media.poster}
          alt={media.title}
          loading="lazy"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      {badge && (
        <span style={{
          position: 'absolute',
          top: '6px',
          left: '6px',
          backgroundColor: 'rgba(0,0,0,0.75)',
          color: '#fff',
          fontSize: '10px',
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: '3px'
        }}>
          {badge}
        </span>
      )}
      {!media.poster && (
        <span style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px',
          textAlign: 'center',
          fontSize: '12px',
          fontWeight: 700,
          color: 'var(--text-secondary)'
        }}>
          {media.title}
        </span>
      )}
    </div>
    {!width && (
      <div style={{
        fontSize: '12px',
        fontWeight: 600,
        color: 'var(--text-secondary)',
        lineHeight: 1.3,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden'
      }}>
        {media.title}
      </div>
    )}
  </div>
);
