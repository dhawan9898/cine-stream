// SearchScreen.tsx - Fast live search across CineHype catalog
import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Film, Tv, Sparkles, TrendingUp } from 'lucide-react';
import { searchMedia, type MediaItem, type MediaType } from '../core/cineHypeCore.ts';
import { MediaCard } from '../components/MediaCard.tsx';

interface SearchScreenProps {
  onSelectMedia: (item: MediaItem) => void;
}

const TRENDING_KEYWORDS = [
  'Deadpool & Wolverine',
  'Stranger Things',
  'Dune',
  'Loki',
  'Avengers',
  'Batman',
  'Spider-Man',
  'Arcane',
  'The Last of Us',
  'John Wick'
];

export const SearchScreen: React.FC<SearchScreenProps> = ({ onSelectMedia }) => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | MediaType>('all');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus input automatically
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 320);
    return () => clearTimeout(handler);
  }, [query]);

  // Execute Search
  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    searchMedia(debouncedQuery)
      .then(items => {
        if (!cancelled) setResults(items);
      })
      .catch(err => {
        console.error('Search error:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [debouncedQuery]);

  // Filtered results
  const filteredResults = filterType === 'all'
    ? results
    : results.filter(i => i.mediaType === filterType);

  return (
    <div style={{ padding: '24px 20px 90px 20px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Search Input Bar */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '4px 18px',
          boxShadow: 'var(--card-shadow)',
          marginBottom: '20px'
        }}
      >
        <Search size={22} color="var(--accent-primary)" style={{ flexShrink: 0, marginRight: '12px' }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movies, TV shows, actors, franchises..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: '16px',
            fontWeight: 500,
            padding: '12px 0',
            outline: 'none'
          }}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="interactive"
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Filter Tabs (when searching) */}
      {results.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          <button
            onClick={() => setFilterType('all')}
            className="interactive"
            style={{
              padding: '6px 16px',
              borderRadius: 'var(--radius-full)',
              background: filterType === 'all' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
              color: filterType === 'all' ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              fontSize: '12px',
              fontWeight: 700
            }}
          >
            All Results ({results.length})
          </button>
          <button
            onClick={() => setFilterType('movie')}
            className="interactive"
            style={{
              padding: '6px 16px',
              borderRadius: 'var(--radius-full)',
              background: filterType === 'movie' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
              color: filterType === 'movie' ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              fontSize: '12px',
              fontWeight: 700
            }}
          >
            Movies ({results.filter(i => i.mediaType === 'movie').length})
          </button>
          <button
            onClick={() => setFilterType('tv')}
            className="interactive"
            style={{
              padding: '6px 16px',
              borderRadius: 'var(--radius-full)',
              background: filterType === 'tv' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
              color: filterType === 'tv' ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              fontSize: '12px',
              fontWeight: 700
            }}
          >
            TV Series ({results.filter(i => i.mediaType === 'tv').length})
          </button>
        </div>
      )}

      {/* Empty / Initial State with Trending Keywords */}
      {!debouncedQuery && (
        <div style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', color: 'var(--text-secondary)' }}>
            <TrendingUp size={18} color="var(--accent-primary)" />
            <h3 style={{ fontSize: '15px', fontWeight: 700 }}>Popular Searches on CineHype</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {TRENDING_KEYWORDS.map(kw => (
              <button
                key={kw}
                onClick={() => setQuery(kw)}
                className="interactive"
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              >
                {kw}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search Results Grid */}
      {filteredResults.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: '16px'
          }}
        >
          {filteredResults.map(item => (
            <MediaCard
              key={`${item.mediaType}-${item.id}`}
              media={item}
              width="100%"
              onClick={() => onSelectMedia(item)}
            />
          ))}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: '16px'
          }}
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{
                width: '100%',
                aspectRatio: '2/3',
                borderRadius: 'var(--radius-md)'
              }}
            />
          ))}
        </div>
      )}

      {/* No results */}
      {!loading && debouncedQuery && filteredResults.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <Film size={44} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
            No titles found for "{debouncedQuery}"
          </h3>
          <p style={{ fontSize: '13px', marginTop: '6px' }}>
            Try checking spelling or search by general keyword.
          </p>
        </div>
      )}
    </div>
  );
};
