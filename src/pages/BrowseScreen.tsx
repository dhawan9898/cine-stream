// BrowseScreen.tsx - Browse one list (a genre, or a Home rail): a poster grid
// that keeps loading more as you scroll, with a "Categories" switcher.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Loader2 } from 'lucide-react';
import type { MediaItem } from '../core/cineHypeCore.ts';
import { SORT_OPTIONS, type BrowseSource, type SortBy } from '../services/browseSources.ts';
import { categorySource, type Category, type TypeFilter } from '../services/categories.ts';
import { computeTaste, EMPTY_TASTE, type Taste } from '../services/tasteService.ts';
import { PosterCard } from '../components/PosterCard.tsx';
import { GenrePicker } from '../components/GenrePicker.tsx';

interface BrowseScreenProps {
  source: BrowseSource;
  onBack: () => void;
  onOpenSource: (source: BrowseSource) => void;
  onSelectMedia: (media: MediaItem) => void;
}

export const BrowseScreen: React.FC<BrowseScreenProps> = ({ source, onBack, onOpenSource, onSelectMedia }) => {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('popularity.desc');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<TypeFilter>(source.category?.filter ?? 'all');
  const [taste, setTaste] = useState<Taste>(EMPTY_TASTE);

  useEffect(() => { computeTaste().then(setTaste).catch(() => {}); }, []);
  const loadingRef = useRef(false);
  // Bumped on sort/source change so a late response for the old request is dropped.
  const generationRef = useRef(0);

  const loadNext = useCallback(async (reset = false) => {
    if (loadingRef.current || (!hasMore && !reset)) return;
    loadingRef.current = true;
    setLoading(true);
    const generation = generationRef.current;
    const next = reset ? 1 : page + 1;
    try {
      const result = await source.load(next, sortBy);
      if (generation !== generationRef.current) return;
      setItems(prev => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map(i => i.id));
        return [...base, ...result.filter(i => !seen.has(i.id))];
      });
      setPage(next);
      setHasMore(result.length > 0 && next < 25);
    } catch (err) {
      // Stop paging instead of leaving the loading flag stuck forever.
      console.warn('[BrowseScreen] page load failed:', err);
      if (generation === generationRef.current) setHasMore(false);
    } finally {
      if (generation === generationRef.current) setLoading(false);
      loadingRef.current = false;
    }
  }, [source, page, hasMore, sortBy]);

  // Reset and load first page on mount or if source.key changes.
  useEffect(() => {
    generationRef.current++;
    loadingRef.current = false;
    setPickerFilter(source.category?.filter ?? 'all');
    setItems([]);
    setPage(0);
    setHasMore(true);
    loadNext(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.key]);

  const changeSort = (next: SortBy) => {
    if (next === sortBy) return;
    generationRef.current++;
    loadingRef.current = false;
    setSortBy(next);
    setItems([]);
    setPage(0);
    setHasMore(true);
  };
  // Reload from page 1 once the new sort has been applied.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    loadNext(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) loadNext();
  };

  const pickCategory = (category: Category, filter: TypeFilter) => {
    setPickerOpen(false);
    if (source.category?.key === category.key && source.category.filter === filter) return;
    onOpenSource(categorySource(category, filter));
  };

  return (
    <div onScroll={handleScroll} className="screen-scroll" style={{ paddingBottom: '110px' }}>
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        backgroundColor: 'var(--bg-main)',
        padding: 'calc(var(--safe-top) + 12px) 16px 12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <button
          onClick={onBack}
          className="interactive glass-pill"
          aria-label="Back"
          style={{ width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)', flexShrink: 0 }}
        >
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ flex: 1, fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{source.title}</h1>
        <button
          onClick={() => setPickerOpen(true)}
          className="interactive glass-pill"
          style={{ padding: '7px 12px', borderRadius: 'var(--radius-full)', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600 }}
        >
          <span>Categories</span>
          <ChevronDown size={16} />
        </button>
      </div>

      {source.category && (
        <div className="rail" style={{ gap: '8px', padding: '0 16px 12px 16px' }}>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => changeSort(opt.id)}
              className={`interactive glass-pill chip ${sortBy === opt.id ? 'active' : ''}`}
              style={{ padding: '6px 14px', borderRadius: 'var(--radius-full)', color: sortBy === opt.id ? undefined : 'var(--text-secondary)', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid-collection" style={{ padding: '4px 16px' }}>
        {items.map(media => (
          <PosterCard key={`${media.mediaType}-${media.id}`} media={media} onClick={() => onSelectMedia(media)} />
        ))}
        {items.length === 0 && loading && Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ borderRadius: '6px', paddingTop: '145%' }} />
        ))}
      </div>

      {loading && items.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
          <Loader2 size={22} className="animate-spin" />
        </div>
      )}
      {!loading && items.length === 0 && (
        <p style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
          Couldn't load {source.title} right now. Check your connection and try again.
        </p>
      )}

      <GenrePicker
        open={pickerOpen}
        filter={pickerFilter}
        onFilterChange={setPickerFilter}
        selectedKey={source.category && source.category.filter === pickerFilter ? source.category.key : undefined}
        suggested={[...taste.languages, ...taste.genres]}
        onClose={() => setPickerOpen(false)}
        onSelect={pickCategory}
      />
    </div>
  );
};
