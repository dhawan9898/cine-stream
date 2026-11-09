// BrowseScreen.tsx - Browse one list (a genre, a language, or a Home rail): a poster grid
// with an interactive Genre Filter Chip Bar, Sort switcher, and Categories picker.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, SlidersHorizontal, Loader2, X } from 'lucide-react';
import { discoverMedia, type MediaItem } from '../providers/cineHypeCore.ts';
import { SORT_OPTIONS, type BrowseSource, type SortBy } from '../services/browseSources.ts';
import {
  GENRES,
  categorySupports,
  categorySource,
  getCategory,
  type Category,
  type TypeFilter
} from '../services/categories.ts';
import { computeTaste, EMPTY_TASTE, type Taste } from '../services/tasteService.ts';
import { PosterCard } from '../components/PosterCard.tsx';
import { GenrePicker } from '../components/GenrePicker.tsx';
import { hapticLight, hapticSelection } from '../services/hapticsService.ts';

interface BrowseScreenProps {
  source: BrowseSource;
  onBack: () => void;
  onOpenSource: (source: BrowseSource) => void;
  onSelectMedia: (media: MediaItem) => void;
}

function interleaveMedia(a: MediaItem[], b: MediaItem[]): MediaItem[] {
  const out: MediaItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    for (const m of [a[i], b[i]]) {
      if (!m) continue;
      const k = `${m.mediaType}-${m.id}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(m);
      }
    }
  }
  return out;
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

  // Determine media type for discovery
  const activeType: TypeFilter = useMemo(() => {
    if (source.category?.filter) return source.category.filter;
    if (source.key.includes('movie')) return 'movie';
    if (source.key.includes('tv') || source.key === 'on-the-air') return 'tv';
    return 'all';
  }, [source]);

  // Initial genre from source if source is already a genre
  const initialGenreKey = useMemo(() => {
    if (source.category && GENRES.some(g => g.key === source.category?.key)) {
      return source.category.key;
    }
    return 'all';
  }, [source]);

  const [selectedGenreKey, setSelectedGenreKey] = useState<string>(initialGenreKey);

  // Available genres based on media type
  const availableGenres = useMemo(() => {
    const list = GENRES.filter(g => categorySupports(g, activeType));
    return [{ key: 'all', name: 'All' }, ...list];
  }, [activeType]);

  useEffect(() => { computeTaste().then(setTaste).catch(() => {}); }, []);
  const loadingRef = useRef(false);
  // Bumped on sort/source/genre change so late responses are dropped.
  const generationRef = useRef(0);

  // Unified loader: handles standard source, language + genre, or genre-filtered discovery
  const fetchPage = useCallback(async (pageNum: number, sort: SortBy, genreKey: string): Promise<MediaItem[]> => {
    // 1. If 'all', load from source (or discover if source was originally a single genre category)
    if (genreKey === 'all') {
      if (source.category && GENRES.some(g => g.key === source.category?.key)) {
        if (activeType === 'all') {
          const [m, t] = await Promise.all([
            discoverMedia({ type: 'movie', page: pageNum, sortBy: sort }).catch(() => [] as MediaItem[]),
            discoverMedia({ type: 'tv', page: pageNum, sortBy: sort }).catch(() => [] as MediaItem[])
          ]);
          return interleaveMedia(m, t);
        }
        return discoverMedia({ type: activeType, page: pageNum, sortBy: sort });
      }
      return source.load(pageNum, sort);
    }

    // 2. Specific genre selected
    const genre = GENRES.find(g => g.key === genreKey);
    if (!genre) return source.load(pageNum, sort);

    // If base source has a language filter (e.g. Telugu, Hindi, Korean)
    const baseCategory = source.category ? getCategory(source.category.key) : undefined;
    const langCode = baseCategory?.language
      ?? (source.category?.key.startsWith('lang-') ? source.category.key.replace('lang-', '') : undefined);

    try {
      if (activeType === 'movie') {
        return await discoverMedia({
          type: 'movie',
          genres: genre.movie,
          language: langCode,
          page: pageNum,
          sortBy: sort
        });
      } else if (activeType === 'tv') {
        return await discoverMedia({
          type: 'tv',
          genres: genre.tv,
          language: langCode,
          page: pageNum,
          sortBy: sort
        });
      } else {
        const [movies, tv] = await Promise.all([
          discoverMedia({ type: 'movie', genres: genre.movie, language: langCode, page: pageNum, sortBy: sort }).catch(() => [] as MediaItem[]),
          discoverMedia({ type: 'tv', genres: genre.tv, language: langCode, page: pageNum, sortBy: sort }).catch(() => [] as MediaItem[])
        ]);
        return interleaveMedia(movies, tv);
      }
    } catch {
      // In-memory or offline fallback: load source and filter locally by genre IDs
      const raw = await source.load(pageNum, sort);
      const targetId = Number(activeType === 'tv' ? (genre.tv || genre.movie) : (genre.movie || genre.tv));
      if (targetId && !isNaN(targetId)) {
        return raw.filter(i => i.genreIds?.includes(targetId));
      }
      return raw;
    }
  }, [source, activeType]);

  const loadNext = useCallback(async (reset = false) => {
    if (loadingRef.current || (!hasMore && !reset)) return;
    loadingRef.current = true;
    setLoading(true);
    const generation = generationRef.current;
    const next = reset ? 1 : page + 1;
    try {
      const result = await fetchPage(next, sortBy, selectedGenreKey);
      if (generation !== generationRef.current) return;
      setItems(prev => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map(i => i.id));
        return [...base, ...result.filter(i => !seen.has(i.id))];
      });
      setPage(next);
      setHasMore(result.length > 0 && next < 25);
    } catch (err) {
      console.warn('[BrowseScreen] page load failed:', err);
      if (generation === generationRef.current) setHasMore(false);
    } finally {
      if (generation === generationRef.current) setLoading(false);
      loadingRef.current = false;
    }
  }, [fetchPage, page, hasMore, sortBy, selectedGenreKey]);

  // Reset and load when source changes
  useEffect(() => {
    generationRef.current++;
    loadingRef.current = false;
    setPickerFilter(source.category?.filter ?? 'all');
    const initialKey = source.category && GENRES.some(g => g.key === source.category?.key)
      ? source.category.key
      : 'all';
    setSelectedGenreKey(initialKey);
    setItems([]);
    setPage(0);
    setHasMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.key]);

  // Reload when genre or sort changes
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
    }
    generationRef.current++;
    loadingRef.current = false;
    setItems([]);
    setPage(0);
    setHasMore(true);
    loadNext(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGenreKey, sortBy, source.key]);

  const changeGenre = (next: string) => {
    if (next === selectedGenreKey) return;
    generationRef.current++;
    loadingRef.current = false;
    setSelectedGenreKey(next);
    setItems([]);
    setPage(0);
    setHasMore(true);
  };

  const changeSort = (next: SortBy) => {
    if (next === sortBy) return;
    generationRef.current++;
    loadingRef.current = false;
    setSortBy(next);
    setItems([]);
    setPage(0);
    setHasMore(true);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) loadNext();
  };

  const pickCategory = (category: Category, filter: TypeFilter) => {
    setPickerOpen(false);
    if (source.category?.key === category.key && source.category.filter === filter) return;
    onOpenSource(categorySource(category, filter));
  };

  const displayTitle = useMemo(() => {
    if (selectedGenreKey !== 'all') {
      const genre = GENRES.find(g => g.key === selectedGenreKey);
      if (genre) {
        const baseCat = source.category ? getCategory(source.category.key) : undefined;
        if (baseCat?.language || source.category?.key.startsWith('lang-')) {
          const langName = baseCat ? baseCat.name : '';
          const suffix = activeType === 'movie' ? ' Movies' : activeType === 'tv' ? ' TV Shows' : ' Movies & Shows';
          return `${langName} ${genre.name}${suffix}`;
        }
        if (source.key.includes('movie')) return `${genre.name} Movies`;
        if (source.key.includes('tv')) return `${genre.name} TV Shows`;
        return `${source.title} · ${genre.name}`;
      }
    }
    return source.title;
  }, [source, selectedGenreKey, activeType]);

  return (
    <div onScroll={handleScroll} className="screen-scroll" style={{ paddingBottom: '110px' }}>
      {/* Sticky Header with Title and Categories Button */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        backgroundColor: 'var(--bg-main)',
        padding: 'calc(var(--safe-top) + 12px) 16px 10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        borderBottom: '1px solid var(--border-subtle)'
      }}>
        <button
          onClick={() => { hapticLight(); onBack(); }}
          className="interactive glass-pill"
          aria-label="Back"
          style={{ width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)', flexShrink: 0 }}
        >
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayTitle}
          </h1>
          {selectedGenreKey !== 'all' && (
            <span style={{ fontSize: '11px', color: 'var(--accent-primary)', fontWeight: 700 }}>
              Filtered by genre
            </span>
          )}
        </div>
        <button
          onClick={() => { hapticLight(); setPickerOpen(true); }}
          className="interactive glass-pill"
          style={{ padding: '7px 12px', borderRadius: 'var(--radius-full)', display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}
        >
          <SlidersHorizontal size={14} />
          <span>Categories</span>
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Genre Filter Chip Bar */}
      <div style={{ padding: '10px 0 4px 0' }}>
        <div
          className="rail"
          style={{
            gap: '8px',
            padding: '0 16px',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {availableGenres.map(genre => {
            const active = selectedGenreKey === genre.key;
            return (
              <button
                key={genre.key}
                onClick={() => {
                  hapticSelection();
                  changeGenre(active && genre.key !== 'all' ? 'all' : genre.key);
                }}
                className={`interactive glass-pill chip ${active ? 'active' : ''}`}
                aria-pressed={active}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '12px',
                  fontWeight: active ? 700 : 600,
                  whiteSpace: 'nowrap',
                  color: active ? '#ffffff' : 'var(--text-secondary)',
                  backgroundColor: active ? 'var(--accent-primary)' : undefined,
                  boxShadow: active ? '0 2px 10px rgba(229, 9, 20, 0.4)' : undefined,
                  border: active ? '1px solid rgba(255,255,255,0.2)' : undefined,
                  transition: 'all 0.18s ease'
                }}
              >
                {genre.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sort Options & Active Filter Status Row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 16px 12px 16px',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => { hapticSelection(); changeSort(opt.id); }}
              className={`interactive glass-pill chip ${sortBy === opt.id ? 'active' : ''}`}
              style={{
                padding: '4px 11px',
                borderRadius: 'var(--radius-full)',
                color: sortBy === opt.id ? undefined : 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: 700,
                whiteSpace: 'nowrap'
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {selectedGenreKey !== 'all' && (
            <button
              onClick={() => changeGenre('all')}
              className="interactive"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                cursor: 'pointer',
                padding: '2px 4px'
              }}
            >
              <X size={12} />
              <span>Reset</span>
            </button>
          )}
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {items.length > 0 ? `${items.length} titles` : ''}
          </span>
        </div>
      </div>

      {/* Poster Grid */}
      <div className="grid-collection" style={{ padding: '4px 16px' }}>
        {items.map(media => (
          <PosterCard key={`${media.mediaType}-${media.id}`} media={media} onSelect={onSelectMedia} />
        ))}
        {items.length === 0 && loading && Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ borderRadius: 'var(--radius-md)', paddingTop: '145%' }} />
        ))}
      </div>

      {loading && items.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
          <Loader2 size={22} className="animate-spin" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
            No titles found
          </p>
          <p style={{ fontSize: '13px', marginBottom: '16px' }}>
            {selectedGenreKey !== 'all'
              ? `No ${GENRES.find(g => g.key === selectedGenreKey)?.name || ''} titles found in this list.`
              : `Couldn't load ${source.title} right now. Check your connection and try again.`}
          </p>
          {selectedGenreKey !== 'all' ? (
            <button
              onClick={() => changeGenre('all')}
              className="interactive glass-pill chip active"
              style={{ padding: '8px 18px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: 700 }}
            >
              Show All Genres
            </button>
          ) : (
            <button
              onClick={() => loadNext(true)}
              className="interactive glass-pill chip active"
              style={{ padding: '8px 18px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: 700 }}
            >
              Retry
            </button>
          )}
        </div>
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
