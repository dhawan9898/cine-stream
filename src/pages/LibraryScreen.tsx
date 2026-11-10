// LibraryScreen.tsx - Watch history and My List.
import React, { useEffect, useState } from 'react';
import { Bookmark, Clock, Download, Play, Trash2, X } from 'lucide-react';
import type { MediaItem } from '../providers/cineHypeCore.ts';
import {
  clearWatchHistory,
  getBookmarks,
  getWatchHistory,
  removeWatchHistory,
  subscribeLibraryChanges,
  type WatchHistoryItem
} from '../services/historyService.ts';
import { FadeImage } from 'streamkit/ui/FadeImage.tsx';
import { PosterCard } from '../components/PosterCard.tsx';
import { DownloadsList } from '../components/DownloadsList.tsx';
import { useDownloads } from '../services/useDownloads.ts';
import type { DownloadRecord } from '../services/downloadService.ts';
import { ConfirmModal } from 'streamkit/ui/ConfirmModal.tsx';
import { hapticLight, hapticMedium, hapticSuccess, hapticWarning } from '../services/hapticsService.ts';

interface LibraryScreenProps {
  onPlayMedia: (item: MediaItem, season?: number, episode?: number) => void;
  onSelectMedia: (item: MediaItem) => void;
  // Plays a downloaded movie/episode (offline).
  onPlayDownload: (record: DownloadRecord) => void;
}

const historyToMedia = (item: WatchHistoryItem): MediaItem => ({
  id: item.id,
  title: item.title,
  mediaType: item.type,
  poster: item.poster,
  backdrop: item.backdrop,
  overview: '',
  releaseDate: '',
  voteAverage: 0
});

const Empty: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => (
  <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px', opacity: 0.8 }}>{icon}</div>
    <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>{title}</p>
    <p style={{ fontSize: '13px' }}>{text}</p>
  </div>
);

export const LibraryScreen: React.FC<LibraryScreenProps> = ({ onPlayMedia, onSelectMedia, onPlayDownload }) => {
  const [tab, setTab] = useState<'history' | 'list' | 'downloads'>('history');
  const downloadedCount = useDownloads().filter(d => d.state === 'completed').length;
  const [history, setHistory] = useState<WatchHistoryItem[]>(() => getWatchHistory());
  const [list, setList] = useState<MediaItem[]>(() => getBookmarks());
  const [confirming, setConfirming] = useState(false);

  useEffect(() => subscribeLibraryChanges(() => {
    setHistory(getWatchHistory());
    setList(getBookmarks());
  }), []);

  return (
    <div className="screen-scroll" style={{ paddingBottom: '110px' }}>
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        backgroundColor: 'var(--bg-main)',
        padding: 'calc(var(--safe-top) + 16px) 20px 14px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>My Library</h1>
        {tab === 'history' && history.length > 0 && (
          <button
            onClick={() => { hapticWarning(); setConfirming(true); }}
            className="interactive"
            style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Trash2 size={16} />
            <span>Clear</span>
          </button>
        )}
      </div>

      <ConfirmModal
        open={confirming}
        title="Clear Watch History"
        message="Are you sure you want to clear your watch history? This cannot be undone."
        confirmLabel="Clear"
        cancelLabel="Cancel"
        danger
        onConfirm={() => { clearWatchHistory(); setConfirming(false); hapticSuccess(); }}
        onCancel={() => setConfirming(false)}
      />

      <div style={{ padding: '16px 20px 8px 20px' }}>
        <div className="seg-track">
          <button onClick={() => { hapticLight(); setTab('history'); }} className={`interactive seg-pill ${tab === 'history' ? 'active' : ''}`}>
            <Clock size={16} />
            <span className="seg-label">History</span>
            {history.length > 0 && <span className="seg-count">{history.length}</span>}
          </button>
          <button onClick={() => { hapticLight(); setTab('list'); }} className={`interactive seg-pill ${tab === 'list' ? 'active' : ''}`}>
            <Bookmark size={16} />
            <span className="seg-label">My List</span>
            {list.length > 0 && <span className="seg-count">{list.length}</span>}
          </button>
          <button onClick={() => { hapticLight(); setTab('downloads'); }} className={`interactive seg-pill ${tab === 'downloads' ? 'active' : ''}`}>
            <Download size={16} />
            <span className="seg-label">Downloads</span>
            {downloadedCount > 0 && <span className="seg-count">{downloadedCount}</span>}
          </button>
        </div>
      </div>

      <div style={{ padding: '12px 20px' }}>
        {tab === 'downloads' ? (
          <DownloadsList onPlay={onPlayDownload} />
        ) : tab === 'history' ? (
          history.length === 0 ? (
            <Empty icon={<Clock size={40} color="var(--accent-primary)" />} title="No watch history" text="Movies and episodes you stream will appear here so you can easily resume." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {history.map(item => (
                <div
                  key={`${item.type}-${item.id}`}
                  onClick={() => { hapticMedium(); onPlayMedia(historyToMedia(item), item.season, item.episode); }}
                  className="interactive glass-panel"
                  style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', gap: '14px', padding: '12px', alignItems: 'center' }}
                >
                  <div style={{ position: 'relative', width: '96px', height: '62px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', flexShrink: 0 }}>
                    <FadeImage src={item.backdrop || item.poster} alt={item.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Play size={13} fill="#fff" color="#fff" style={{ marginLeft: '1px' }} />
                      </div>
                    </div>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', backgroundColor: 'rgba(255,255,255,0.2)' }}>
                      <div style={{ width: `${Math.min(100, item.progressPercent)}%`, height: '100%', background: 'var(--accent-primary)' }} />
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.2px' }}>{item.title}</h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {item.type === 'tv' && item.season ? `S${item.season} E${item.episode} • ` : ''}{Math.round(item.progressPercent)}% watched
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); hapticLight(); removeWatchHistory(item.id, item.type); }}
                    className="interactive glass-pill"
                    aria-label={`Remove ${item.title} from history`}
                    style={{ width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', color: 'var(--text-muted)', flexShrink: 0 }}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )
        ) : list.length === 0 ? (
          <Empty icon={<Bookmark size={40} color="var(--accent-primary)" />} title="Your list is empty" text="Tap + on a movie or show to save it here." />
        ) : (
          <div className="grid-collection">
            {list.map(media => (
              <PosterCard key={`${media.mediaType}-${media.id}`} media={media} onSelect={onSelectMedia} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
