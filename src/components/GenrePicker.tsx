// GenrePicker.tsx - CineStream's "Categories" overlay: For You / Moods /
// Languages / Genres in the shared category picker, with a Movies-TV filter on top.
import React, { useMemo } from 'react';
import { CategoryPicker, type CategorySection } from 'streamkit/ui/CategoryPicker.tsx';
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
  const groups = useMemo(() => [
    { title: 'For You', items: suggested },
    { title: 'Moods', items: MOODS },
    { title: 'Languages', items: LANGUAGES },
    { title: 'Genres', items: GENRES }
  ].map(g => ({ ...g, items: g.items.filter(c => categorySupports(c, filter)) }))
    .filter(g => g.items.length > 0), [suggested, filter]);

  const sections: CategorySection[] = useMemo(
    () => groups.map(g => ({ title: g.title, items: g.items.map(c => ({ key: c.key, name: c.name })) })),
    [groups]
  );

  const header = (
    <div className="seg-track" style={{ width: '260px', marginBottom: '4px' }}>
      {FILTERS.map(f => (
        <button key={f.id} onClick={() => onFilterChange(f.id)} className={`interactive seg-pill ${filter === f.id ? 'active' : ''}`}>{f.label}</button>
      ))}
    </div>
  );

  return (
    <CategoryPicker
      open={open}
      sections={sections}
      selectedKey={selectedKey}
      header={header}
      onSelect={key => {
        const category = groups.flatMap(g => g.items).find(c => c.key === key);
        if (category) onSelect(category, filter);
      }}
      onClose={onClose}
    />
  );
};
