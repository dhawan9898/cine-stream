// SearchScreen.tsx - Live search across the catalog, plus Browse by Genre.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search as SearchIcon, X, Loader2 } from 'lucide-react';
import { MOVIE_GENRES, TV_GENRES, searchMedia, type MediaItem, type MediaType } from '../core/cineHypeCore.ts';
import { genreSource, type BrowseSource } from '../services/browseSources.ts';
import { FadeImage } from '../components/FadeImage.tsx';

interface SearchScreenProps {
  // True while this tab is the visible one (tabs stay mounted when hidden).
  active: boolean;
  onBack: () => void;
  onSelectMedia: (item: MediaItem) => void;
  onOpenSource: (source: BrowseSource) => void;
}

const POPULAR_TAGS = ['Deadpool & Wolverine', 'Stranger Things', 'Dune', 'Loki', 'Avengers', 'Batman', 'Spider-Man', 'Arcane', 'The Last of Us', 'John Wick'];
const GENRE_TILE_COLORS = ['#b91c1c', '#7c3aed', '#0e7490', '#b45309', '#be185d', '#15803d', '#1d4ed8', '#9f1239'];

export const SearchScreen: React.FC<SearchScreenProps> = ({ active, onBack, onSelectMedia, onOpenSource }) => {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<'all' | MediaType>('all');
  const [genreType, setGenreType] = useState<MediaType>('movie');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 320);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debounced) { setResults([]); setLoading(false); setError(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(false);
    searchMedia(debounced)
      .then(items => { if (!cancelled) setResults(items); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced, attempt]);

  const shown = filter === 'all' ? results : results.filter(r => r.mediaType === filter);
  const genres = genreType === 'movie' ? MOVIE_GENRES : TV_GENRES;
  const typing = query.trim() !== debounced;

  return (
    <div className="screen-scroll" style={{ paddingBottom: '110px' }}>
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        backgroundColor: 'var(--bg-main)',
        padding: 'calc(var(--safe-top) + 12px) 16px 12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        borderBottom: '1px solid var(--border-subtle)'
      }}>
        <button
          onClick={onBack}
          className="interactive glass-pill"
          aria-label="Back"
          style={{ width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)', flexShrink: 0 }}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="glass-panel" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: 'var(--radius-full)' }}>
          <SearchIcon size={18} color="var(--text-muted)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search movies, shows…"
            aria-label="Search movies and shows"
            enterKeyHint="search"
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 0, backgroundColor: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500 }}
          />
          {query && (
            <button onClick={() => setQuery('')} className="interactive" aria-label="Clear search" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', display: 'flex' }}>
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="rail" style={{ padding: '14px 20px', gap: '8px' }}>
        {POPULAR_TAGS.map(tag => {
          const on = query.toLowerCase() === tag.toLowerCase();
          return (
            <button
              key={tag}
              onClick={() => setQuery(tag)}
              className={`interactive glass-pill chip ${on ? 'active' : ''}`}
              style={{ padding: '6px 14px', borderRadius: 'var(--radius-full)', color: on ? undefined : 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}
            >
              {tag}
            </button>
          );
        })}
      </div>

      {query && !loading && !error && results.length > 0 && (
        <div style={{ padding: '0 20px 12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {([['all', 'All'], ['movie', 'Movies'], ['tv', 'TV']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`interactive glass-pill chip ${filter === id ? 'active' : ''}`}
                style={{ padding: '5px 12px', borderRadius: 'var(--radius-full)', color: filter === id ? undefined : 'var(--text-secondary)', fontSize: '12px', fontWeight: 700 }}
              >
                {label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{shown.length} results</span>
        </div>
      )}

      {loading || (query && typing) ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: '10px', color: 'var(--text-secondary)' }}>
          <Loader2 size={24} className="animate-spin" />
          <span style={{ fontSize: '14px' }}>Searching…</span>
        </div>
      ) : !query ? (
        <div style={{ padding: '4px 20px 0 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', gap: '12px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>Browse by Genre</h2>
            <div className="seg-track" style={{ width: '170px' }}>
              <button onClick={() => setGenreType('movie')} className={`interactive seg-pill ${genreType === 'movie' ? 'active' : ''}`} style={{ padding: '5px' }}>Movies</button>
              <button onClick={() => setGenreType('tv')} className={`interactive seg-pill ${genreType === 'tv' ? 'active' : ''}`} style={{ padding: '5px' }}>TV</button>
            </div>
          </div>
          <div className="grid-genres">
            {genres.map((genre, i) => (
              <button
                key={genre.id}
                onClick={() => onOpenSource(genreSource(genre, genreType))}
                className="interactive"
                style={{
                  height: '64px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  padding: '0 14px',
                  display: 'flex',
                  alignItems: 'center',
                  background: `linear-gradient(135deg, ${GENRE_TILE_COLORS[i % GENRE_TILE_COLORS.length]} 0%, rgba(0,0,0,0.55) 140%)`,
                  color: '#fff',
                  fontSize: '15px',
                  fontWeight: 800,
                  textAlign: 'left'
                }}
              >
                {genre.name}
              </button>
            ))}
          </div>
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>Couldn't reach the server</p>
          <p style={{ fontSize: '13px', marginBottom: '16px' }}>Check your connection and try again.</p>
          <button onClick={() => setAttempt(n => n + 1)} className="interactive glass-pill chip active" style={{ padding: '10px 22px', borderRadius: 'var(--radius-full)', fontSize: '13px', fontWeight: 700 }}>
            Retry
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>Nothing found</p>
          <p style={{ fontSize: '13px' }}>Try a different title or keyword.</p>
        </div>
      ) : (
        <div className="grid-posters" style={{ padding: '0 20px' }}>
          {shown.map(media => (
            <div
              key={`${media.mediaType}-${media.id}`}
              onClick={() => onSelectMedia(media)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectMedia(media); } }}
              role="button"
              tabIndex={0}
              aria-label={media.title}
              className="interactive glass-panel"
              style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ position: 'relative', width: '100%', paddingTop: '140%', overflow: 'hidden' }}>
                <FadeImage src={media.poster} alt={media.title} loading="lazy" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', top: '8px', right: '8px', backgroundColor: 'rgba(0,0,0,0.72)', padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, color: '#e2e8f0' }}>
                  {media.mediaType === 'tv' ? 'TV' : 'Movie'}
                </div>
              </div>
              <div style={{ padding: '10px', flex: 1 }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: '1.3', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: '6px' }}>
                  {media.title}
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {media.releaseDate ? media.releaseDate.slice(0, 4) : ''}{media.voteAverage > 0 ? ` · ★ ${media.voteAverage}` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
