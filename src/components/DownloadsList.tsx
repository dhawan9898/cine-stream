// DownloadsList.tsx - Library "Downloads" tab: saved movies and episodes, grouped by title.
import React, { useEffect, useMemo, useState } from 'react';
import { Download, Play, Trash2, RotateCw, WifiOff } from 'lucide-react';
import { FadeImage } from 'streamkit/ui/FadeImage.tsx';
import { ConfirmModal } from 'streamkit/ui/ConfirmModal.tsx';
import {
  downloadsSupported, formatBytes, getOfflinePoster, removeAllDownloads, removeDownload, startDownload,
  type DownloadRecord
} from '../services/downloadService.ts';
import { useDownloads } from '../services/useDownloads.ts';
import { hapticLight, hapticMedium, hapticSuccess, hapticWarning } from '../services/hapticsService.ts';

interface DownloadsListProps {
  onPlay: (record: DownloadRecord) => void;
}

interface Group {
  key: string;
  type: 'movie' | 'tv';
  mediaId: number;
  title: string;
  poster?: string;
  items: DownloadRecord[];
}

export const DownloadsList: React.FC<DownloadsListProps> = ({ onPlay }) => {
  const downloads = useDownloads();
  const [posters, setPosters] = useState<Record<string, string>>({});
  const [confirmingClear, setConfirmingClear] = useState(false);

  const groups = useMemo<Group[]>(() => {
    const byTitle = new Map<string, Group>();
    for (const rec of downloads) {
      const key = `${rec.media.mediaType}-${rec.media.id}`;
      let g = byTitle.get(key);
      if (!g) {
        g = { key, type: rec.media.mediaType, mediaId: rec.media.id, title: rec.media.title, poster: rec.media.poster, items: [] };
        byTitle.set(key, g);
      }
      g.items.push(rec);
    }
    for (const g of byTitle.values()) {
      g.items.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
    }
    return [...byTitle.values()];
  }, [downloads]);

  // Cover art saved with the download keeps showing offline.
  useEffect(() => {
    let cancelled = false;
    for (const g of groups) {
      if (posters[g.key]) continue;
      getOfflinePoster(g.type, g.mediaId).then(p => {
        if (p && !cancelled) setPosters(prev => (prev[g.key] ? prev : { ...prev, [g.key]: p }));
      });
    }
    return () => { cancelled = true; };
  }, [groups, posters]);

  if (!downloadsSupported()) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
        <WifiOff size={40} color="var(--accent-primary)" style={{ margin: '0 auto 12px auto', opacity: 0.8 }} />
        <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>Downloads need the Android app</p>
        <p style={{ fontSize: '13px' }}>Install the CineStream APK to save movies and episodes and watch them offline.</p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
        <Download size={40} color="var(--accent-primary)" style={{ margin: '0 auto 12px auto', opacity: 0.8 }} />
        <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>No downloads yet</p>
        <p style={{ fontSize: '13px' }}>Tap the download button on a movie or episode to watch it without internet.</p>
      </div>
    );
  }

  const total = downloads.reduce((sum, r) => sum + (r.state === 'completed' ? r.bytes : 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: '12px' }}>
        <span>{formatBytes(total)} used</span>
        <button
          onClick={() => { hapticWarning(); setConfirmingClear(true); }}
          className="interactive"
          style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <Trash2 size={15} /><span>Delete all</span>
        </button>
      </div>

      <ConfirmModal
        open={confirmingClear}
        title="Delete all downloads"
        message="Every downloaded movie and episode will be removed from this device."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={async () => { setConfirmingClear(false); await removeAllDownloads(); hapticSuccess(); }}
        onCancel={() => setConfirmingClear(false)}
      />

      {groups.map(g => (
        <div key={g.key} className="glass-panel" style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', padding: '12px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ width: '48px', height: '68px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', flexShrink: 0, background: 'var(--track-bg)' }}>
              <FadeImage src={posters[g.key] || g.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.title}</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {g.type === 'movie' ? 'Movie' : `${g.items.length} episode${g.items.length === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>

          {g.items.map(rec => <Row key={rec.id} rec={rec} onPlay={onPlay} />)}
        </div>
      ))}
    </div>
  );
};

const Row: React.FC<{ rec: DownloadRecord; onPlay: (r: DownloadRecord) => void }> = ({ rec, onPlay }) => {
  const done = rec.state === 'completed';
  const failed = rec.state === 'failed';
  const pct = Math.round(rec.percent);
  const status = done ? formatBytes(rec.bytes)
    : failed ? (rec.error ? `Failed - ${rec.error}` : 'Failed - tap retry')
    : rec.state === 'queued' ? 'Waiting…'
    : rec.state === 'stopped' ? `Paused at ${pct}% - waiting for a connection`
    : `${pct}%`;
  const label = rec.media.mediaType === 'movie'
    ? rec.media.title
    : `S${rec.season ?? 1}:E${rec.episode ?? 1}${rec.episodeName ? ` · ${rec.episodeName}` : ''}`;

  return (
    <div
      onClick={() => { if (done) { hapticMedium(); onPlay(rec); } }}
      className={done ? 'interactive' : undefined}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 4px', borderTop: '1px solid var(--border-subtle)', cursor: done ? 'pointer' : 'default' }}
    >
      <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: done ? 'var(--accent-primary)' : 'var(--track-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {done ? <Play size={13} fill="#fff" color="#fff" style={{ marginLeft: '1px' }} /> : <Download size={14} color="var(--text-secondary)" />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</p>
        <p style={{ fontSize: '12px', color: failed ? 'var(--accent-danger)' : 'var(--text-secondary)', marginTop: '1px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{status}</p>
      </div>
      {failed && (
        <button
          onClick={e => { e.stopPropagation(); hapticLight(); startDownload(rec.media, rec.season, rec.episode, rec.episodeName).catch(() => undefined); }}
          aria-label={`Retry ${label}`}
          className="interactive glass-pill"
          style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}
        >
          <RotateCw size={15} />
        </button>
      )}
      <button
        onClick={e => { e.stopPropagation(); hapticLight(); void removeDownload(rec.id); }}
        aria-label={done ? `Delete ${label}` : `Cancel ${label}`}
        className="interactive glass-pill"
        style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
      >
        <Trash2 size={15} />
      </button>
      {!done && !failed && (
        <span style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: `${pct}%`, background: 'var(--accent-primary)', transition: 'width 0.4s linear' }} />
      )}
    </div>
  );
};
