// GenrePicker.tsx - Netflix-style "Categories" overlay: a dimmed full-screen
// list, centered, grouped into For You / Languages / Genres / Moods, with a
// Movies-TV filter on top and a round close button pinned at the bottom.
import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBackHandler } from '../services/backStack.ts';
import {
  GENRES,
  LANGUAGES,
  MOODS,
  categorySupports,
  type Category,
  type TypeFilter
} from '../services/categories.ts';

interface GenrePickerProps {
  open: boolean;
  filter: TypeFilter;
  onFilterChange: (filter: TypeFilter) => void;
  selectedKey?: string;
  // Categories learned from the viewer's history, shown first.
  suggested?: Category[];
  onSelect: (category: Category, filter: TypeFilter) => void;
  onClose: () => void;
}

const FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'TV Shows' }
];

export const GenrePicker: React.FC<GenrePickerProps> = ({ open, filter, onFilterChange, selectedKey, suggested = [], onSelect, onClose }) => {
  useBackHandler(open, onClose);
  if (!open) return null;

  const sections: { title: string; items: Category[] }[] = [
    { title: 'For You', items: suggested },
    { title: 'Moods', items: MOODS },
    { title: 'Languages', items: LANGUAGES },
    { title: 'Genres', items: GENRES }
  ]
    .map(sec => ({ ...sec, items: sec.items.filter(c => categorySupports(c, filter)) }))
    .filter(sec => sec.items.length > 0);

  // Portaled to <body>: the screens sit inside their own stacking contexts,
  // which would otherwise keep this overlay underneath the dock.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Categories"
      data-modal-root="true"
      className="animate-fade-in"
      style={{ position: 'fixed', inset: 0, zIndex: 9500, backgroundColor: 'rgba(0, 0, 0, 0.9)', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ flex: 1, overflowY: 'auto', padding: 'calc(var(--safe-top) + 24px) 20px 120px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <div className="seg-track" style={{ width: '260px', marginBottom: '4px' }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => onFilterChange(f.id)} className={`interactive seg-pill ${filter === f.id ? 'active' : ''}`}>{f.label}</button>
          ))}
        </div>

        {sections.map(sec => (
          <section key={sec.title} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: '100%' }}>
            <h3 style={{ marginTop: '12px', fontSize: '11px', fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{sec.title}</h3>
            {sec.items.map(category => {
              const active = category.key === selectedKey;
              return (
                <button
                  key={`${sec.title}-${category.key}`}
                  onClick={() => onSelect(category, filter)}
                  aria-current={active ? 'true' : undefined}
                  style={{ background: 'none', border: 'none', color: active ? '#fff' : '#b3b3b3', fontSize: active ? '22px' : '18px', fontWeight: active ? 800 : 500, cursor: 'pointer' }}
                >
                  {category.name}
                </button>
              );
            })}
          </section>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '24px 0 calc(var(--safe-bottom) + 28px) 0', display: 'flex', justifyContent: 'center', background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.95) 45%)' }}>
        <button
          onClick={onClose}
          aria-label="Close categories"
          style={{ width: '56px', height: '56px', borderRadius: '50%', border: 'none', backgroundColor: '#fff', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <X size={26} />
        </button>
      </div>
    </div>,
    document.body
  );
};
