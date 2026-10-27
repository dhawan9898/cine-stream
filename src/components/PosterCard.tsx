// PosterCard.tsx - Compact poster tile used by the horizontal rails and the
// poster grids (browse pages, More Like This). Flat and opaque on purpose.
import React, { useEffect, useRef } from 'react';
import type { MediaItem } from '../core/cineHypeCore.ts';
import { prefetchMediaDetails } from '../core/cineHypeCore.ts';
import { FadeImage } from './FadeImage.tsx';

interface PosterCardProps {
  media: MediaItem;
  onClick: () => void;
  // Fixed width for use inside a horizontal rail; omit to fill a grid cell
  // (grid cells also show the title underneath).
  width?: number;
  badge?: string;
  // Long-press (or the context-menu key) opens a quick preview.
  onPreview?: (media: MediaItem) => void;
}

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

export const PosterCard: React.FC<PosterCardProps> = ({ media, onClick, width, badge, onPreview }) => {
  const timer = useRef<number>(0);
  const origin = useRef({ x: 0, y: 0 });
  // Set when a long press fired so the click that follows the release is ignored.
  const fired = useRef(false);

  const cancel = () => { window.clearTimeout(timer.current); timer.current = 0; };
  useEffect(() => cancel, []);

  return (
  <div
    onClick={() => {
      if (fired.current) { fired.current = false; return; }
      onClick();
    }}
    onPointerDown={e => {
      if (!onPreview) return;
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(15);
        onPreview(media);
      }, LONG_PRESS_MS);
    }}
    onPointerMove={e => {
      if (!timer.current) return;
      if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > MOVE_TOLERANCE_PX) cancel();
    }}
    onPointerUp={cancel}
    onPointerCancel={cancel}
    onPointerLeave={cancel}
    onContextMenu={e => { if (onPreview) e.preventDefault(); }}
    onMouseEnter={() => prefetchMediaDetails(media.id, media.mediaType)}
    onFocus={() => prefetchMediaDetails(media.id, media.mediaType)}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      } else if (onPreview && (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) {
        e.preventDefault();
        onPreview(media);
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
      gap: '6px',
      WebkitTouchCallout: 'none',
      userSelect: 'none'
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
      {media.voteAverage >= 1 && (
        <span style={{
          position: 'absolute',
          bottom: '6px',
          left: '6px',
          backgroundColor: 'rgba(0,0,0,0.72)',
          color: '#fbbf24',
          fontSize: '10px',
          fontWeight: 800,
          padding: '2px 5px',
          borderRadius: '3px'
        }}>
          ★ {media.voteAverage.toFixed(1)}
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
};
