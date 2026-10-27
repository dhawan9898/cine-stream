// QuickPreview.tsx - Bottom sheet opened by long-pressing a poster: backdrop,
// rating, genres, synopsis and the three actions (Play, My List, More info),
// so a title can be judged without leaving the row.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Plus, Check, Info, X, Star } from 'lucide-react';
import { MOVIE_GENRES, TV_GENRES, type MediaItem } from '../core/cineHypeCore.ts';
import { useBackHandler } from '../services/backStack.ts';
import { getBookmarks, subscribeLibraryChanges, toggleBookmark } from '../services/historyService.ts';
import { FadeImage } from './FadeImage.tsx';

interface QuickPreviewProps {
  media: MediaItem | null;
  onClose: () => void;
  onPlay: (media: MediaItem) => void;
  onOpenDetails: (media: MediaItem) => void;
}

const GENRE_NAMES = new Map<number, string>(
  [...MOVIE_GENRES, ...TV_GENRES].filter(g => g.id < 2000).map(g => [g.id, g.name])
);

export const QuickPreview: React.FC<QuickPreviewProps> = ({ media, onClose, onPlay, onOpenDetails }) => {
  useBackHandler(media !== null, onClose);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!media) return;
    const sync = () => setSaved(getBookmarks().some(b => b.id === media.id && b.mediaType === media.mediaType));
    sync();
    return subscribeLibraryChanges(sync);
  }, [media]);

  if (!media) return null;
  const year = media.releaseDate?.slice(0, 4);
  const genres = (media.genreIds ?? []).map(id => GENRE_NAMES.get(id)).filter(Boolean).slice(0, 3);
  const meta = [media.mediaType === 'tv' ? 'Series' : 'Movie', year, ...genres].filter(Boolean).join(' • ');

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={media.title}
      data-modal-root="true"
      onClick={onClose}
      className="animate-fade-in"
      style={{ position: 'fixed', inset: 0, zIndex: 9400, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '85%', overflowY: 'auto', backgroundColor: 'var(--bg-surface)', borderRadius: '16px 16px 0 0', paddingBottom: 'calc(var(--safe-bottom) + 20px)' }}
      >
        <div style={{ position: 'relative', height: '190px' }}>
          <FadeImage src={media.backdrop || media.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 30%, var(--bg-surface) 100%)' }} />
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="interactive"
            style={{ position: 'absolute', top: '12px', right: '12px', width: '34px', height: '34px', borderRadius: '50%', border: 'none', backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '0 20px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px' }}>{media.title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '14px' }}>
            {media.voteAverage >= 1 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#fbbf24' }}>
                <Star size={13} fill="#fbbf24" /> {media.voteAverage.toFixed(1)}
              </span>
            )}
            <span>{meta}</span>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            <button onClick={() => { onClose(); onPlay(media); }} className="interactive hero-play">
              <Play size={18} fill="#000" /><span>Play</span>
            </button>
            <button
              onClick={() => toggleBookmark(media)}
              className="interactive glass-pill hero-list"
              aria-pressed={saved}
              aria-label={saved ? 'Remove from My List' : 'Add to My List'}
            >
              {saved ? <Check size={18} /> : <Plus size={18} />}
              <span>My List</span>
            </button>
            <button onClick={() => { onClose(); onOpenDetails(media); }} className="interactive glass-pill hero-list" aria-label="More info">
              <Info size={18} />
            </button>
          </div>

          {media.overview && <p style={{ fontSize: '14px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>{media.overview}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
};
