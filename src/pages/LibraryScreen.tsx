// LibraryScreen.tsx - Watch History & Bookmarks Management
import React, { useState, useEffect } from 'react';
import { Bookmark, Clock, Trash2, Play, Film, ChevronRight } from 'lucide-react';
import {
  getWatchHistory,
  getBookmarks,
  removeWatchHistory,
  clearWatchHistory,
  toggleBookmark,
  subscribeLibraryChanges,
  type WatchHistoryItem
} from '../services/historyService.ts';
import type { MediaItem } from '../core/cineHypeCore.ts';
import { FadeImage } from '../components/FadeImage.tsx';
import { MediaCard } from '../components/MediaCard.tsx';

interface LibraryScreenProps {
  onPlayMedia: (item: MediaItem, season?: number, episode?: number) => void;
  onSelectMedia: (item: MediaItem) => void;
  onOpenExplore: () => void;
}

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  onPlayMedia,
  onSelectMedia,
  onOpenExplore
}) => {
  const [tab, setTab] = useState<'history' | 'bookmarks'>('history');
  const [history, setHistory] = useState<WatchHistoryItem[]>([]);
  const [bookmarks, setBookmarks] = useState<MediaItem[]>([]);

  const loadData = () => {
    setHistory(getWatchHistory());
    setBookmarks(getBookmarks());
  };

  useEffect(() => {
    loadData();
    return subscribeLibraryChanges(() => loadData());
  }, []);

  return (
    <div style={{ padding: '24px 20px 90px 20px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Title */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '26px', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
          My Library
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Track your watch history and saved bookmarks
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '12px',
          marginBottom: '24px'
        }}
      >
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setTab('history')}
            className="interactive"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 18px',
              borderRadius: 'var(--radius-full)',
              background: tab === 'history' ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.06)',
              color: tab === 'history' ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              fontSize: '13px',
              fontWeight: 700
            }}
          >
            <Clock size={15} />
            <span>Watch History ({history.length})</span>
          </button>

          <button
            onClick={() => setTab('bookmarks')}
            className="interactive"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 18px',
              borderRadius: 'var(--radius-full)',
              background: tab === 'bookmarks' ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.06)',
              color: tab === 'bookmarks' ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              fontSize: '13px',
              fontWeight: 700
            }}
          >
            <Bookmark size={15} />
            <span>My Watchlist ({bookmarks.length})</span>
          </button>
        </div>

        {tab === 'history' && history.length > 0 && (
          <button
            onClick={clearWatchHistory}
            className="interactive"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'none',
              border: 'none',
              color: 'var(--accent-primary)',
              fontSize: '12px',
              fontWeight: 600
            }}
          >
            <Trash2 size={14} />
            <span>Clear History</span>
          </button>
        )}
      </div>

      {/* History Tab Content */}
      {tab === 'history' && (
        <div>
          {history.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '16px'
              }}
            >
              {history.map(item => {
                const media: MediaItem = {
                  id: item.id,
                  title: item.title,
                  mediaType: item.type,
                  poster: item.poster,
                  backdrop: item.backdrop,
                  overview: '',
                  releaseDate: '',
                  voteAverage: 0
                };

                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    style={{
                      background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                      border: '1px solid var(--border-subtle)',
                      boxShadow: 'var(--card-shadow)',
                      display: 'flex',
                      flexDirection: 'column'
                    }}
                  >
                    <div style={{ position: 'relative', width: '100%', height: '140px' }}>
                      <FadeImage src={item.backdrop || item.poster} alt={item.title} />

                      {/* Progress Bar */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: '4px',
                          background: 'rgba(255,255,255,0.2)'
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${item.progressPercent || 30}%`,
                            background: 'var(--accent-primary)'
                          }}
                        />
                      </div>

                      {/* Remove Button */}
                      <button
                        onClick={() => removeWatchHistory(item.id, item.type)}
                        className="interactive"
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: 'rgba(0,0,0,0.6)',
                          border: 'none',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        title="Remove from history"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div style={{ padding: '14px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <h4
                          style={{
                            fontSize: '14px',
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {item.title}
                        </h4>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {item.type === 'tv' ? `Season ${item.season || 1} • Episode ${item.episode || 1}` : 'Feature Film'}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                        <button
                          onClick={() => onPlayMedia(media, item.season, item.episode)}
                          className="btn-primary interactive"
                          style={{ flex: 1, padding: '8px', fontSize: '13px' }}
                        >
                          <Play size={14} fill="#fff" />
                          <span>Resume</span>
                        </button>
                        <button
                          onClick={() => onSelectMedia(media)}
                          className="btn-secondary interactive"
                          style={{ padding: '8px 14px', fontSize: '13px' }}
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
              <Clock size={44} style={{ opacity: 0.3, marginBottom: '12px' }} />
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                No watch history yet
              </h3>
              <p style={{ fontSize: '13px', marginTop: '6px', marginBottom: '20px' }}>
                Movies and shows you watch will appear here so you can pick up right where you left off.
              </p>
              <button onClick={onOpenExplore} className="btn-primary interactive">
                Explore Content
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bookmarks Tab Content */}
      {tab === 'bookmarks' && (
        <div>
          {bookmarks.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: '16px'
              }}
            >
              {bookmarks.map(item => (
                <div key={`${item.mediaType}-${item.id}`} style={{ position: 'relative' }}>
                  <MediaCard
                    media={item}
                    width="100%"
                    onClick={() => onSelectMedia(item)}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBookmark(item);
                    }}
                    className="interactive"
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.7)',
                      border: 'none',
                      color: 'var(--accent-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 10
                    }}
                    title="Remove from list"
                  >
                    <Bookmark size={14} fill="var(--accent-primary)" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
              <Bookmark size={44} style={{ opacity: 0.3, marginBottom: '12px' }} />
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Your Watchlist is empty
              </h3>
              <p style={{ fontSize: '13px', marginTop: '6px', marginBottom: '20px' }}>
                Save titles to watch later by clicking "Add to List" on any movie or TV show.
              </p>
              <button onClick={onOpenExplore} className="btn-primary interactive">
                Browse Popular Titles
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
