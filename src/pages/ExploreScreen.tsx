// ExploreScreen.tsx - Catalog browser with filters, genres & sorting
import React, { useState, useEffect } from 'react';
import { Filter, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import {
  MOVIE_GENRES,
  TV_GENRES,
  discoverByGenre,
  getPopularMovies,
  getPopularTV,
  getTopRatedMovies,
  getTopRatedTV,
  type MediaItem,
  type MediaType
} from '../core/cineHypeCore.ts';
import { MediaCard } from '../components/MediaCard.tsx';

interface ExploreScreenProps {
  onSelectMedia: (item: MediaItem) => void;
}

export const ExploreScreen: React.FC<ExploreScreenProps> = ({ onSelectMedia }) => {
  const [mediaType, setMediaType] = useState<MediaType>('movie');
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'popularity.desc' | 'vote_average.desc' | 'primary_release_date.desc'>('popularity.desc');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  const genres = mediaType === 'movie' ? MOVIE_GENRES : TV_GENRES;

  useEffect(() => {
    setPage(1);
    setItems([]);
  }, [mediaType, selectedGenre, sortBy]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const loadData = async () => {
      try {
        let newItems: MediaItem[] = [];
        if (selectedGenre) {
          newItems = await discoverByGenre(selectedGenre, mediaType, page, sortBy);
        } else {
          if (sortBy === 'vote_average.desc') {
            newItems = mediaType === 'movie' ? await getTopRatedMovies(page) : await getTopRatedTV(page);
          } else {
            newItems = mediaType === 'movie' ? await getPopularMovies(page) : await getPopularTV(page);
          }
        }

        if (!cancelled) {
          setItems(prev => page === 1 ? newItems : [...prev, ...newItems]);
        }
      } catch (err) {
        console.error('Explore load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadData();
    return () => { cancelled = true; };
  }, [mediaType, selectedGenre, sortBy, page]);

  return (
    <div style={{ padding: '24px 20px 90px 20px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Title & Filter Controls Header */}
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '26px', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
          Explore Catalog
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Browse thousands of movies and TV series indexed by CineHype
        </p>
      </div>

      {/* Type Toggle & Sort Options */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px'
        }}
      >
        {/* Movie vs TV Toggle */}
        <div
          style={{
            display: 'inline-flex',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-full)',
            padding: '4px'
          }}
        >
          <button
            onClick={() => {
              setMediaType('movie');
              setSelectedGenre(null);
            }}
            className="interactive"
            style={{
              padding: '6px 16px',
              borderRadius: 'var(--radius-full)',
              background: mediaType === 'movie' ? 'var(--accent-gradient)' : 'transparent',
              color: mediaType === 'movie' ? '#fff' : 'var(--text-muted)',
              border: 'none',
              fontSize: '13px',
              fontWeight: 700
            }}
          >
            Movies
          </button>
          <button
            onClick={() => {
              setMediaType('tv');
              setSelectedGenre(null);
            }}
            className="interactive"
            style={{
              padding: '6px 16px',
              borderRadius: 'var(--radius-full)',
              background: mediaType === 'tv' ? 'var(--accent-gradient)' : 'transparent',
              color: mediaType === 'tv' ? '#fff' : 'var(--text-muted)',
              border: 'none',
              fontSize: '13px',
              fontWeight: 700
            }}
          >
            TV Series
          </button>
        </div>

        {/* Sort selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ArrowUpDown size={15} color="var(--text-muted)" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 12px',
              fontSize: '13px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="popularity.desc">Most Popular</option>
            <option value="vote_average.desc">Highest Rated</option>
            <option value="primary_release_date.desc">Latest Releases</option>
          </select>
        </div>
      </div>

      {/* Genre Pills Rail */}
      <div className="rail" style={{ gap: '8px', marginBottom: '24px', paddingBottom: '4px' }}>
        <button
          onClick={() => setSelectedGenre(null)}
          className="interactive"
          style={{
            padding: '7px 16px',
            borderRadius: 'var(--radius-full)',
            background: selectedGenre === null ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.06)',
            color: selectedGenre === null ? '#ffffff' : 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            fontSize: '12px',
            fontWeight: 700,
            whiteSpace: 'nowrap'
          }}
        >
          All Genres
        </button>
        {genres.map(g => {
          const isSelected = selectedGenre === g.id;
          return (
            <button
              key={g.id}
              onClick={() => setSelectedGenre(g.id)}
              className="interactive"
              style={{
                padding: '7px 16px',
                borderRadius: 'var(--radius-full)',
                background: isSelected ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.06)',
                color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                fontSize: '12px',
                fontWeight: 600,
                whiteSpace: 'nowrap'
              }}
            >
              {g.name}
            </button>
          );
        })}
      </div>

      {/* Media Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: '16px',
          marginBottom: '32px'
        }}
      >
        {items.map(item => (
          <MediaCard
            key={`${item.mediaType}-${item.id}`}
            media={item}
            width="100%"
            onClick={() => onSelectMedia(item)}
          />
        ))}

        {loading &&
          Array.from({ length: 12 }).map((_, i) => (
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

      {/* Load More Button */}
      {!loading && items.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
          <button
            onClick={() => setPage(p => p + 1)}
            className="btn-secondary interactive"
            style={{ padding: '12px 36px', fontSize: '14px', fontWeight: 700 }}
          >
            Load More Titles
          </button>
        </div>
      )}
    </div>
  );
};
