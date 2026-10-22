// MediaRail.tsx - Horizontal scrolling rail of media items with scroll controls
import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MediaItem } from '../core/cineHypeCore.ts';
import { MediaCard } from './MediaCard.tsx';

interface MediaRailProps {
  title: string;
  subtitle?: string;
  items: MediaItem[] | null;
  onSelect: (item: MediaItem) => void;
  onSeeAll?: () => void;
  cardWidth?: number;
}

export const MediaRail: React.FC<MediaRailProps> = ({
  title,
  subtitle,
  items,
  onSelect,
  onSeeAll,
  cardWidth = 140
}) => {
  const railRef = useRef<HTMLDivElement | null>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!railRef.current) return;
    const amount = direction === 'left' ? -420 : 420;
    railRef.current.scrollBy({ left: amount, behavior: 'smooth' });
  };

  return (
    <div style={{ marginBottom: '28px' }}>
      {/* Rail Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          padding: '0 24px',
          marginBottom: '12px'
        }}
      >
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            {title}
          </h3>
          {subtitle && (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {subtitle}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onSeeAll && (
            <button
              onClick={onSeeAll}
              className="interactive"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-primary)',
                fontSize: '13px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                padding: '4px 8px'
              }}
            >
              <span>Explore all</span>
              <ChevronRight size={16} />
            </button>
          )}

          {/* Desktop Left / Right buttons */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => scroll('left')}
              className="interactive"
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              aria-label="Scroll left"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => scroll('right')}
              className="interactive"
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              aria-label="Scroll right"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Rail Scroll Container */}
      <div
        ref={railRef}
        className="rail"
        style={{
          gap: '14px',
          padding: '0 24px 8px 24px'
        }}
      >
        {items && items.length > 0
          ? items.map(item => (
              <MediaCard
                key={`${item.mediaType}-${item.id}`}
                media={item}
                width={cardWidth}
                onClick={() => onSelect(item)}
              />
            ))
          : Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="skeleton"
                style={{
                  flex: `0 0 ${cardWidth}px`,
                  width: cardWidth,
                  aspectRatio: '2/3',
                  borderRadius: 'var(--radius-md)'
                }}
              />
            ))}
      </div>
    </div>
  );
};
