// PosterCard.tsx - Compact poster tile used by the horizontal rails and the
// poster grids (browse pages, More Like This). Same squircle poster, sheen and
// bouncy press feel as AniStream's tiles.
import React, { memo, useEffect, useRef } from 'react';
import type { MediaItem } from '../providers/cineHypeCore.ts';
import { prefetchMediaDetails, posterSrcSet } from '../providers/cineHypeCore.ts';
import { Priority, prefetchStream } from '../providers/streamResolver.ts';
import { FadeImage } from 'streamkit/ui/FadeImage.tsx';
import { hapticMedium } from '../services/hapticsService.ts';
import { openPreview } from '../services/previewService.ts';

interface PosterCardProps {
  media: MediaItem;
  // Receives the card's media so callers can pass one stable handler for a whole
  // list (an inline closure per card would defeat memo()).
  // The poster's on-screen rect lets the title page fly the poster into place.
  onSelect: (media: MediaItem, rect?: DOMRect) => void;
  // Fixed width for use inside a horizontal rail; omit to fill a grid cell
  // (grid cells also show the title underneath).
  width?: number;
  badge?: string;
  // Long-press (or the context-menu key) opens a quick preview; by default the
  // shared one rendered by App.
  onPreview?: (media: MediaItem) => void;
}

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

const PosterCardBase: React.FC<PosterCardProps> = ({ media, onSelect, width, badge, onPreview = openPreview }) => {
  const posterRef = useRef<HTMLDivElement | null>(null);
  const onClick = () => {
    hapticMedium();
    onSelect(media, posterRef.current?.getBoundingClientRect());
  };
  const timer = useRef<number>(0);
  const origin = useRef({ x: 0, y: 0 });
  // Set when a long press fired so the click that follows the release is ignored.
  const fired = useRef(false);

  const cancel = () => { window.clearTimeout(timer.current); timer.current = 0; };
  useEffect(() => cancel, []);

  const handlePrefetch = () => {
    prefetchMediaDetails(media.id, media.mediaType);
    prefetchStream({
      id: media.id,
      type: media.mediaType,
      title: media.title,
      language: media.language,
      season: 1,
      episode: 1
    }, { priority: Priority.FOCUS });
  };

  return (
  <div
    onClick={() => {
      if (fired.current) { fired.current = false; return; }
      onClick();
    }}
    onPointerDown={e => {
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        hapticMedium();
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
    onContextMenu={e => e.preventDefault()}
    onMouseEnter={handlePrefetch}
    onFocus={handlePrefetch}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      } else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) {
        e.preventDefault();
        onPreview(media);
      }
    }}
    role="button"
    tabIndex={0}
    aria-label={media.title}
    className="interactive card-bouncy poster-card"
    style={{
      flex: width ? `0 0 ${width}px` : undefined,
      width: width ? `${width}px` : '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      cursor: 'pointer',
      WebkitTouchCallout: 'none',
      userSelect: 'none'
    }}
  >
    <div ref={posterRef} style={{
      position: 'relative',
      width: '100%',
      paddingTop: '142%',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      backgroundColor: 'rgba(127, 127, 127, 0.12)',
      boxShadow: 'var(--card-shadow)',
      border: '1px solid var(--border-subtle)'
    }}>
      {media.poster && (
        <FadeImage
          {...posterSrcSet(media.poster)}
          sizes={width ? `${width}px` : '(max-width: 600px) 33vw, 180px'}
          alt={media.title}
          loading="lazy"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      {/* Specular glass sheen on the top edge, like AniStream's tiles */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 24%, rgba(0,0,0,0.55) 100%)' }} />
      {badge && (
        <span style={{
          position: 'absolute',
          top: '8px',
          left: '8px',
          backgroundColor: 'rgba(12, 12, 16, 0.65)',
          WebkitBackdropFilter: 'blur(14px)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          color: '#fff',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.2px',
          padding: '3px 7px',
          borderRadius: 'var(--radius-xs)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)'
        }}>
          {badge}
        </span>
      )}
      {media.voteAverage >= 1 && (
        <span style={{
          position: 'absolute',
          bottom: '8px',
          right: '8px',
          backgroundColor: 'rgba(12, 12, 16, 0.65)',
          WebkitBackdropFilter: 'blur(12px)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          color: '#fbbf24',
          fontSize: '11px',
          fontWeight: 800,
          padding: '2px 6px',
          borderRadius: 'var(--radius-xs)'
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
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--text-secondary)',
        letterSpacing: '-0.2px',
        lineHeight: 1.35,
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

export const PosterCard = memo(PosterCardBase);

