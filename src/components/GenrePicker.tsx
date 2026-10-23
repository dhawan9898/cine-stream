// GenrePicker.tsx - Netflix "Categories" overlay: a dimmed full-screen list
// of genre names, centered, with a round close button pinned at the bottom.
import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { MOVIE_GENRES, TV_GENRES, type Genre, type MediaType } from '../core/cineHypeCore.ts';

interface GenrePickerProps {
  open: boolean;
  type: MediaType;
  onTypeChange: (type: MediaType) => void;
  selectedId?: number;
  onSelect: (genre: Genre, type: MediaType) => void;
  onClose: () => void;
}

export const GenrePicker: React.FC<GenrePickerProps> = ({ open, type, onTypeChange, selectedId, onSelect, onClose }) => {
  if (!open) return null;
  const genres = type === 'movie' ? MOVIE_GENRES : TV_GENRES;

  // Portaled to <body>: the screens sit inside their own stacking contexts,
  // which would otherwise keep this overlay underneath the dock.
  return createPortal(
    <div
      className="animate-fade-in"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9500,
        backgroundColor: 'rgba(0, 0, 0, 0.88)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 'calc(var(--safe-top) + 24px) 20px 120px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '22px'
      }}>
        <div className="seg-track" style={{ width: '220px', marginBottom: '6px' }}>
          <button onClick={() => onTypeChange('movie')} className={`interactive seg-pill ${type === 'movie' ? 'active' : ''}`}>Movies</button>
          <button onClick={() => onTypeChange('tv')} className={`interactive seg-pill ${type === 'tv' ? 'active' : ''}`}>TV Shows</button>
        </div>
        {genres.map(genre => {
          const active = genre.id === selectedId;
          return (
            <button
              key={genre.id}
              onClick={() => onSelect(genre, type)}
              style={{
                background: 'none',
                border: 'none',
                color: active ? '#fff' : '#b3b3b3',
                fontSize: active ? '22px' : '18px',
                fontWeight: active ? 800 : 500,
                cursor: 'pointer'
              }}
            >
              {genre.name}
            </button>
          );
        })}
      </div>
      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: '24px 0 calc(var(--safe-bottom) + 28px) 0',
        display: 'flex',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.95) 45%)'
      }}>
        <button
          onClick={onClose}
          aria-label="Close categories"
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            border: 'none',
            backgroundColor: '#fff',
            color: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <X size={26} />
        </button>
      </div>
    </div>,
    document.body
  );
};
