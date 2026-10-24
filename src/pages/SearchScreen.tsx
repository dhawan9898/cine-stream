// SearchScreen.tsx - Netflix-style search: Top Searches while the box is
// empty, a poster grid of live results once you type.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search as SearchIcon, X, Loader2, Play } from 'lucide-react';
import { getTrending, searchMedia, type MediaItem, type MediaType } from '../core/cineHypeCore.ts';
import { FadeImage } from '../components/FadeImage.tsx';
import { PosterCard } from '../components/PosterCard.tsx';

interface SearchScreenProps {
  // True while this tab is the visible one (tabs stay mounted when hidden).
  active: boolean;
  onBack: () => void;
  onSelectMedia: (item: MediaItem) => void;
}

export const SearchScreen: React.FC<SearchScreenProps> = ({ active, onBack, onSelectMedia }) => {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<'all' | MediaType>('all');
  const [topSearches, setTopSearches] = useState<MediaItem[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    getTrending('all', 'week')
      .then(list => { if (!cancelled) setTopSearches(list.slice(0, 12)); })
      .catch(() => { /* the empty state simply stays blank */ });
    return () => { cancelled = true; };
  }, []);

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
            placeholder="Search for a show, movie, genre…"
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

      {query && !loading && !error && results.length > 0 && (
        <div style={{ padding: '14px 20px 12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
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
        <div style={{ padding: '18px 20px 0 20px' }}>
          <h2 style={{ fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '12px' }}>Top Searches</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {topSearches.length === 0 && Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: '68px', borderRadius: '6px' }} />
            ))}
            {topSearches.map(media => (
              <button
                key={`${media.mediaType}-${media.id}`}
                onClick={() => onSelectMedia(media)}
                className="interactive"
                style={{ display: 'flex', alignItems: 'center', gap: '14px', background: 'var(--bg-surface)', border: 'none', borderRadius: '6px', padding: 0, overflow: 'hidden', textAlign: 'left', color: 'var(--text-primary)' }}
              >
                <div style={{ position: 'relative', width: '120px', height: '68px', flexShrink: 0, backgroundColor: 'rgba(127,127,127,0.15)' }}>
                  <FadeImage src={media.backdrop || media.poster} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <span style={{ flex: 1, minWidth: 0, fontSize: '14px', fontWeight: 700, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {media.title}
                </span>
                <span style={{ width: '34px', height: '34px', margin: '0 14px 0 4px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Play size={14} fill="#fff" color="#fff" style={{ marginLeft: '2px' }} />
                </span>
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
        <div style={{ textAlign: 'center', padding: '60px 28px', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>No results for "{query}"</p>
          <p style={{ fontSize: '13px' }}>Try searching for another title, actor or genre.</p>
        </div>
      ) : (
        <div style={{ padding: '0 16px' }}>
          <h2 style={{ fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 4px 12px 4px' }}>Movies &amp; TV</h2>
          <div className="grid-collection">
            {shown.map(media => (
              <PosterCard key={`${media.mediaType}-${media.id}`} media={media} onClick={() => onSelectMedia(media)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
