// SettingsScreen.tsx - App Preferences, Streaming Server & Theme Settings
import React, { useState, useEffect } from 'react';
import {
  Server,
  Palette,
  Trash2,
  Globe,
  ShieldCheck,
  Check,
  Info,
  Tv,
  Film
} from 'lucide-react';
import { STREAM_SERVERS } from '../services/streamResolver.ts';
import {
  getUserPreferences,
  saveUserPreferences,
  clearWatchHistory
} from '../services/historyService.ts';
import { getSavedTheme, applyTheme, type Theme } from '../services/themeService.ts';
import { clearPersistedCache } from '../core/persistentCache.ts';

export const SettingsScreen: React.FC = () => {
  const [prefs, setPrefs] = useState(getUserPreferences());
  const [currentTheme, setCurrentTheme] = useState<Theme>(getSavedTheme());
  const [notification, setNotification] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleServerChange = (serverId: string) => {
    saveUserPreferences({ defaultServer: serverId });
    setPrefs(getUserPreferences());
    showToast(`Default server set to ${STREAM_SERVERS.find(s => s.id === serverId)?.name}`);
  };

  const handleThemeChange = (t: Theme) => {
    applyTheme(t);
    setCurrentTheme(t);
    saveUserPreferences({ theme: t });
    showToast(`Theme changed to ${t}`);
  };

  const handleClearCache = () => {
    clearPersistedCache();
    showToast('Cache memory cleared successfully');
  };

  const handleClearHistory = () => {
    clearWatchHistory();
    showToast('Watch history wiped');
  };

  return (
    <div style={{ padding: '24px 20px 90px 20px', maxWidth: '800px', margin: '0 auto' }}>
      {/* Title */}
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '26px', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
          Settings & Preferences
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Configure CineHype streaming provider, player behavior and themes
        </p>
      </div>

      {/* Toast Notification */}
      {notification && (
        <div
          style={{
            position: 'fixed',
            top: '80px',
            right: '24px',
            zIndex: 1000,
            background: 'var(--accent-gradient)',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            fontSize: '13px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Check size={16} />
          <span>{notification}</span>
        </div>
      )}

      {/* 1. Streaming Provider Settings */}
      <div
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          padding: '24px',
          marginBottom: '24px',
          boxShadow: 'var(--card-shadow)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <Server size={22} color="var(--accent-primary)" />
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Default Streaming Server
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Preferred CineHype mirror when launching video playback
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {STREAM_SERVERS.map(srv => {
            const isSelected = prefs.defaultServer === srv.id;
            return (
              <button
                key={srv.id}
                onClick={() => handleServerChange(srv.id)}
                className="interactive"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-sm)',
                  background: isSelected ? 'rgba(229, 9, 20, 0.16)' : 'rgba(255,255,255,0.03)',
                  border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  textAlign: 'left'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {srv.name}
                    </span>
                    <span className="badge" style={{ fontSize: '9px', background: isSelected ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)', color: '#fff' }}>
                      {srv.badge}
                    </span>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {srv.description}
                  </span>
                </div>
                {isSelected && <Check size={18} color="var(--accent-primary)" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Theme Selection */}
      <div
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          padding: '24px',
          marginBottom: '24px',
          boxShadow: 'var(--card-shadow)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <Palette size={22} color="var(--accent-primary)" />
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Appearance & Theme
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Choose your visual design palette
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
          {[
            { id: 'dark', label: 'Cinema Crimson', desc: 'CineHype signature dark', color: '#e50914' },
            { id: 'obsidian', label: 'Obsidian OLED', desc: 'Deep black for OLEDs', color: '#ff1f29' },
            { id: 'slate', label: 'Midnight Slate', desc: 'Deep navy & sky blue', color: '#38bdf8' },
            { id: 'light', label: 'Daylight', desc: 'Clean frosted light mode', color: '#e50914' }
          ].map(t => {
            const isSelected = currentTheme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => handleThemeChange(t.id as Theme)}
                className="interactive"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '14px',
                  borderRadius: 'var(--radius-md)',
                  background: isSelected ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                  border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  textAlign: 'left'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: t.color }} />
                  {isSelected && <Check size={16} color="var(--accent-primary)" />}
                </div>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {t.label}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {t.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Storage & Cache Management */}
      <div
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          padding: '24px',
          marginBottom: '24px',
          boxShadow: 'var(--card-shadow)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <Trash2 size={22} color="var(--accent-primary)" />
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Data & Storage
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Manage local cache and watch history
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={handleClearCache}
            className="btn-secondary interactive"
            style={{ fontSize: '13px' }}
          >
            Clear Local Cache
          </button>
          <button
            onClick={handleClearHistory}
            className="btn-secondary interactive"
            style={{ fontSize: '13px', color: 'var(--accent-primary)' }}
          >
            Clear Watch History
          </button>
        </div>
      </div>

      {/* 4. Provider & App Info */}
      <div
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          padding: '24px',
          boxShadow: 'var(--card-shadow)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <Globe size={22} color="var(--accent-primary)" />
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Provider Information
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Active streaming configuration
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span>Active Provider:</span>
            <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>cinehype.sc</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span>Catalog Engine:</span>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>TMDB v3 (CineHype Node)</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span>Stream Mirrors:</span>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>VidFast • VidSrc • ScreenFetch • Rypr</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span>Application:</span>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>CineStream v{__APP_VERSION__}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
