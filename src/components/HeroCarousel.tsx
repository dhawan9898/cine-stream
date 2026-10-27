// HeroCarousel.tsx - Netflix-style featured banner: swipe between the top
// trending titles (native scroll-snap, so it tracks the finger 1:1), with
// page dots and an auto-advance that steps aside while the user is touching
// it or a screen covers it.
import React, { useEffect, useRef, useState } from 'react';
import { Play, Plus, Check, Info } from 'lucide-react';
import { MOVIE_GENRES, TV_GENRES, type MediaItem } from '../core/cineHypeCore.ts';
import { FadeImage } from './FadeImage.tsx';
import { getBookmarks, subscribeLibraryChanges, toggleBookmark } from '../services/historyService.ts';

const MAX_SLIDES = 8;
const AUTO_ADVANCE_MS = 6000;
// After a manual swipe, wait this long before auto-advancing again.
const USER_IDLE_MS = 10000;
const HERO_HEIGHT = 440;

interface HeroCarouselProps {
  items: MediaItem[];
  onPlay: (item: MediaItem) => void;
  onOpenDetails: (item: MediaItem) => void;
  // True while another screen covers this one - no auto-advance then.
  paused?: boolean;
}

const GENRE_NAMES = new Map<number, string>(
  [...MOVIE_GENRES, ...TV_GENRES].filter(g => g.id < 2000).map(g => [g.id, g.name])
);
const genreLine = (m: MediaItem) =>
  (m.genreIds ?? []).map(id => GENRE_NAMES.get(id)).filter(Boolean).slice(0, 3).join(' • ');

const key = (m: MediaItem) => `${m.mediaType}-${m.id}`;

export const HeroCarousel: React.FC<HeroCarouselProps> = ({ items, onPlay, onOpenDetails, paused = false }) => {
  const slides = items.slice(0, MAX_SLIDES);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const lastTouchRef = useRef<number>(0);
  const [index, setIndex] = useState<number>(0);
  const [saved, setSaved] = useState<Set<string>>(() => new Set(getBookmarks().map(key)));

  useEffect(() => subscribeLibraryChanges(() => setSaved(new Set(getBookmarks().map(key)))), []);

  // Current slide follows the scroll position (rAF-throttled).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const width = track.clientWidth || 1;
        setIndex(Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollLeft / width))));
      });
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      track.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [slides.length]);

  const goTo = (i: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  };

  // Auto-advance; skipped while hidden, covered, or recently touched.
  useEffect(() => {
    if (slides.length < 2 || paused) return;
    const timer = window.setInterval(() => {
      if (document.hidden || Date.now() - lastTouchRef.current < USER_IDLE_MS) return;
      const track = trackRef.current;
      if (!track) return;
      const current = Math.round(track.scrollLeft / (track.clientWidth || 1));
      goTo((current + 1) % slides.length);
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [slides.length, paused]);

  const markTouched = () => { lastTouchRef.current = Date.now(); };

  if (slides.length === 0) {
    return <div className="skeleton" style={{ width: '100%', height: `${HERO_HEIGHT}px`, marginTop: '-60px', borderRadius: 0 }} />;
  }

  return (
    <div style={{ position: 'relative', marginTop: '-60px' }}>
      <div
        ref={trackRef}
        className="hero-track"
        onTouchStart={markTouched}
        onPointerDown={markTouched}
        onWheel={markTouched}
      >
        {slides.map((media, i) => {
          const inList = saved.has(key(media));
          const year = media.releaseDate ? media.releaseDate.slice(0, 4) : '';
          return (
            <div key={key(media)} className="hero-slide" style={{ height: `${HERO_HEIGHT}px` }}>
              <FadeImage
                src={media.backdrop || media.poster}
                alt=""
                loading={i === 0 ? 'eager' : 'lazy'}
                className="hero-img"
              />
              <div className="hero-overlay">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span className="hero-rank">#{i + 1} in Trending</span>
                  <span className="glass-pill-dark" style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px', color: '#cbd5e1' }}>
                    {media.mediaType === 'tv' ? 'Series' : 'Movie'}
                  </span>
                  {year && (
                    <span className="glass-pill-dark" style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px', color: '#cbd5e1' }}>
                      {year}
                    </span>
                  )}
                </div>
                <h1 className="hero-title">{media.title}</h1>
                {genreLine(media) && (
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#e5e5e5', marginBottom: '6px', textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>
                    {genreLine(media)}
                  </div>
                )}
                {media.overview && <p className="hero-desc">{media.overview}</p>}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => onPlay(media)} className="interactive hero-play">
                    <Play size={18} fill="#000" />
                    <span>Play</span>
                  </button>
                  <button onClick={() => onOpenDetails(media)} className="interactive glass-pill-dark hero-list" aria-label="More info">
                    <Info size={18} />
                    <span>Info</span>
                  </button>
                  <button
                    onClick={() => toggleBookmark(media)}
                    className="interactive glass-pill-dark hero-list"
                    aria-label={inList ? 'Remove from My List' : 'Add to My List'}
                    aria-pressed={inList}
                  >
                    {inList ? <Check size={18} /> : <Plus size={18} />}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {slides.length > 1 && (
        <div className="hero-dots" role="tablist" aria-label="Featured titles">
          {slides.map((media, i) => (
            <button
              key={key(media)}
              role="tab"
              aria-selected={i === index}
              aria-label={`Show ${media.title}`}
              onClick={() => { markTouched(); goTo(i); }}
              className={i === index ? 'hero-dot active' : 'hero-dot'}
            />
          ))}
        </div>
      )}
    </div>
  );
};
