// GenrePicker.tsx - Netflix-style "Categories" overlay: Genres & Themes
// in a sleek modal card with quick search and TV Shows / Movies filter.
import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { CategoryPicker, type CategorySection } from 'streamkit/ui/CategoryPicker.tsx';
import {
  GENRES,
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
  { id: 'tv', label: 'TV Shows' },
  { id: 'movie', label: 'Movies' }
];

export const GenrePicker: React.FC<GenrePickerProps> = ({ open, filter, onFilterChange, selectedKey, suggested = [], onSelect, onClose }) => {
  const [search, setSearch] = useState('');

  // Netflix-style categories: strictly genres and themes, no regional languages
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const suggestedGenres = suggested.filter(c => c.group === 'genre' || c.group === 'mood');
    return [
      { title: 'For You', items: suggestedGenres },
      { title: 'Genres', items: GENRES },
      { title: 'Moods & Collections', items: MOODS }
    ].map(g => ({
      ...g,
      items: g.items
        .filter(c => categorySupports(c, filter))
        .filter(c => !q || c.name.toLowerCase().includes(q))
    })).filter(g => g.items.length > 0);
  }, [suggested, filter, search]);

  const sections: CategorySection[] = useMemo(
    () => groups.map(g => ({ title: g.title, items: g.items.map(c => ({ key: c.key, name: c.name })) })),
    [groups]
  );

  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '0 4px 12px 4px' }}>
      <div className="seg-track" style={{ width: '100%' }}>
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => onFilterChange(f.id)}
            className={`interactive seg-pill ${filter === f.id ? 'active' : ''}`}
            style={{ fontWeight: 700 }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div
        className="glass-panel"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderRadius: 'var(--radius-full)',
          backgroundColor: 'rgba(255, 255, 255, 0.06)'
        }}
      >
        <Search size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search categories (e.g. Action, Comedy)..."
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: '13px',
            outline: 'none'
          }}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label="Clear search"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', display: 'flex', padding: 0, cursor: 'pointer' }}
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <CategoryPicker
      open={open}
      presentation="card"
      title="Categories"
      sections={sections}
      selectedKey={selectedKey}
      header={header}
      onSelect={key => {
        const category = groups.flatMap(g => g.items).find(c => c.key === key);
        if (category) onSelect(category, filter);
      }}
      onClose={() => {
        setSearch('');
        onClose();
      }}
    />
  );
};
