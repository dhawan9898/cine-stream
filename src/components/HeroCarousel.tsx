// HeroCarousel.tsx - Prominent hero showcase of trending movies & series
import React, { useState, useEffect } from 'react';
import { Play, Info, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import type { MediaItem } from '../core/cineHypeCore.ts';
import { FadeImage } from './FadeImage.tsx';

interface HeroCarouselProps {
  items: MediaItem[];
  onPlay: (item: MediaItem) => void;
  onOpenDetails: (item: MediaItem) => void;
}

export const HeroCarousel: React.FC<HeroCarouselProps> = ({
  items,
  onPlay,
  onOpenDetails
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const heroItems = items.slice(0, 6);

  useEffect(() => {
    if (heroItems.length === 0 || isPaused) return;
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % heroItems.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [heroItems.length, isPaused]);

  if (heroItems.length === 0) {
    return (
      <div
        className="skeleton"
        style={{
          width: '100%',
          height: '65vh',
          minHeight: '440px',
          maxHeight: '620px',
          borderRadius: 0
        }}
      />
    );
  }

  const current = heroItems[currentIndex];
  const year = current.releaseDate ? current.releaseDate.slice(0, 4) : '';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '68vh',
        minHeight: '460px',
        maxHeight: '640px',
        overflow: 'hidden',
        background: '#000000'
      }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Background Backdrop with Gradient Overlays */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1
        }}
      >
        <FadeImage
          src={current.backdrop || current.poster}
          alt={current.title}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'brightness(0.75)'
          }}
        />
        {/* Cinematic Multi-stop Vignette */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `
              linear-gradient(to top, var(--bg-main) 0%, rgba(10, 11, 15, 0.7) 40%, transparent 80%),
              linear-gradient(to right, rgba(10, 11, 15, 0.95) 0%, rgba(10, 11, 15, 0.5) 45%, transparent 100%)
            `
          }}
        />
      </div>

      {/* Content Area */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '0 28px 48px 28px',
          zIndex: 2,
          maxWidth: '850px'
        }}
      >
        {/* Meta badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <span className="badge badge-red">
            {current.mediaType === 'tv' ? 'TV SERIES' : 'FEATURE FILM'}
          </span>
          <span className="badge badge-glass">
            CINEHYPE SELECTION
          </span>
          {year && (
            <span className="badge badge-glass">
              {year}
            </span>
          )}
          {current.voteAverage > 0 && (
            <span
              className="badge"
              style={{
                background: 'rgba(245, 158, 11, 0.2)',
                color: 'var(--accent-gold)',
                border: '1px solid rgba(245, 158, 11, 0.4)'
              }}
            >
              <Star size={12} fill="var(--accent-gold)" color="var(--accent-gold)" />
              {current.voteAverage} / 10
            </span>
          )}
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: 'clamp(28px, 5vw, 48px)',
            fontWeight: 800,
            lineHeight: 1.15,
            color: '#ffffff',
            letterSpacing: '-0.8px',
            marginBottom: '12px',
            textShadow: '0 2px 10px rgba(0,0,0,0.8)'
          }}
        >
          {current.title}
        </h1>

        {/* Overview Synopsis */}
        <p
          style={{
            fontSize: '14px',
            color: 'rgba(255, 255, 255, 0.85)',
            lineHeight: 1.6,
            maxWidth: '680px',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            marginBottom: '22px',
            textShadow: '0 1px 4px rgba(0,0,0,0.6)'
          }}
        >
          {current.overview || 'Stream this title in high definition with multi-source server resolution on CineStream.'}
        </p>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={() => onPlay(current)}
            className="btn-primary"
            style={{ fontSize: '15px', padding: '12px 28px' }}
          >
            <Play size={18} fill="#ffffff" />
            <span>Watch Now</span>
          </button>

          <button
            onClick={() => onOpenDetails(current)}
            className="btn-secondary"
            style={{ fontSize: '15px' }}
          >
            <Info size={18} />
            <span>More Info</span>
          </button>
        </div>
      </div>

      {/* Navigation arrows (desktop) */}
      <button
        onClick={() => setCurrentIndex((currentIndex - 1 + heroItems.length) % heroItems.length)}
        className="interactive"
        style={{
          position: 'absolute',
          top: '50%',
          left: '16px',
          transform: 'translateY(-50%)',
          zIndex: 3,
          width: '42px',
          height: '42px',
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        aria-label="Previous slide"
      >
        <ChevronLeft size={22} />
      </button>

      <button
        onClick={() => setCurrentIndex((currentIndex + 1) % heroItems.length)}
        className="interactive"
        style={{
          position: 'absolute',
          top: '50%',
          right: '16px',
          transform: 'translateY(-50%)',
          zIndex: 3,
          width: '42px',
          height: '42px',
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        aria-label="Next slide"
      >
        <ChevronRight size={22} />
      </button>

      {/* Dots Indicator */}
      <div
        style={{
          position: 'absolute',
          bottom: '18px',
          right: '28px',
          display: 'flex',
          gap: '8px',
          zIndex: 3
        }}
      >
        {heroItems.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentIndex(i)}
            style={{
              width: i === currentIndex ? '26px' : '8px',
              height: '8px',
              borderRadius: '4px',
              background: i === currentIndex ? 'var(--accent-primary)' : 'rgba(255,255,255,0.3)',
              border: 'none',
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
};
