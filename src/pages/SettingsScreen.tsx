// SettingsScreen.tsx - Appearance, playback, data, and Telegram integration settings.
import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, SkipForward, Trash2, Database, Send, LogOut, CheckCircle2, ChevronRight } from 'lucide-react';
import { clearWatchHistory, getUserPreferences, saveUserPreferences, getWatchHistory } from '../services/historyService.ts';
import { getSavedTheme, applyTheme, type Theme } from '../services/themeService.ts';
import { clearPersistedCache } from '../core/persistentCache.ts';
import { ConfirmModal } from '../components/ConfirmModal.tsx';
import { TelegramAuthModal } from '../components/TelegramAuthModal.tsx';
import { telegramService } from '../services/telegramService.ts';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'obsidian', label: 'OLED' },
  { id: 'slate', label: 'Slate' },
  { id: 'light', label: 'Light' }
];

const IconBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ width: '38px', height: '38px', borderRadius: 'var(--radius-sm)', background: 'rgba(229, 9, 20, 0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', flexShrink: 0 }}>
    {children}
  </div>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '10px' }}>
    {children}
  </h2>
);

const Row: React.FC<{
  icon: React.ReactNode;
  title: string;
  text: string;
  onClick: () => void;
  trailing: React.ReactNode;
  danger?: boolean;
}> = ({ icon, title, text, onClick, trailing, danger }) => (
  <div onClick={onClick} className="interactive" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px' }}>
    <IconBox>{icon}</IconBox>
    <div style={{ flex: 1, minWidth: 0 }}>
      <h4 style={{ fontSize: '14px', fontWeight: 700, color: danger ? 'var(--accent-danger)' : 'var(--text-primary)' }}>{title}</h4>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{text}</p>
    </div>
    {trailing}
  </div>
);

export const SettingsScreen: React.FC = () => {
  const [prefs, setPrefs] = useState(getUserPreferences());
  const [theme, setTheme] = useState<Theme>(getSavedTheme());
  const [historyCount, setHistoryCount] = useState(() => getWatchHistory().length);
  const [confirming, setConfirming] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  // Telegram Integration state
  const [telegramAuthOpen, setTelegramAuthOpen] = useState(false);
  const [tgStatus, setTgStatus] = useState<{ isLoggedIn: boolean; username?: string; phone?: string }>({ isLoggedIn: false });
  const [selectedChannelsCount, setSelectedChannelsCount] = useState(0);

  const refreshTgStatus = async () => {
    const status = await telegramService.getAuthStatus();
    setTgStatus(status);
    if (status.isLoggedIn) {
      const channels = await telegramService.getSelectedChannels();
      setSelectedChannelsCount(channels.length);
    } else {
      setSelectedChannelsCount(0);
    }
  };

  useEffect(() => {
    refreshTgStatus();
  }, []);

  const update = (patch: Partial<typeof prefs>) => {
    saveUserPreferences(patch);
    setPrefs(getUserPreferences());
  };

  const changeTheme = (t: Theme) => {
    applyTheme(t);
    setTheme(t);
    saveUserPreferences({ theme: t });
  };

  const handleTgLogout = async () => {
    await telegramService.logout();
    await refreshTgStatus();
  };

  return (
    <div className="screen-scroll" style={{ paddingBottom: '110px' }}>
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        backgroundColor: 'var(--bg-main)',
        padding: 'calc(var(--safe-top) + 16px) 20px 14px 20px',
        borderBottom: '1px solid var(--border-subtle)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-glow)' }}>
            <SettingsIcon size={18} color="#fff" />
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>Settings</h1>
        </div>
      </div>

      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <section>
          <SectionLabel>Telegram Library</SectionLabel>
          <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            {tgStatus.isLoggedIn ? (
              <>
                <Row
                  icon={<Send size={18} />}
                  title={`Telegram Connected (${tgStatus.username ? '@' + tgStatus.username : tgStatus.phone || 'User'})`}
                  text={`${selectedChannelsCount} ${selectedChannelsCount === 1 ? 'channel' : 'channels'} selected for media scanning`}
                  onClick={() => setTelegramAuthOpen(true)}
                  trailing={<ChevronRight size={18} color="var(--text-muted)" />}
                />
                <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <Row
                    icon={<LogOut size={18} />}
                    title="Disconnect Telegram"
                    text="Log out and clear saved channel indexing"
                    onClick={handleTgLogout}
                    danger
                    trailing={<LogOut size={18} color="var(--accent-danger)" />}
                  />
                </div>
              </>
            ) : (
              <Row
                icon={<Send size={18} />}
                title="Connect Telegram Account"
                text="Stream movies and TV shows directly from your private Telegram channels"
                onClick={() => setTelegramAuthOpen(true)}
                trailing={<ChevronRight size={18} color="var(--text-muted)" />}
              />
            )}
          </div>
        </section>

        <section>
          <SectionLabel>Appearance</SectionLabel>
          <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', padding: '16px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>Theme</h4>
            <div className="seg-track">
              {THEMES.map(t => (
                <button key={t.id} onClick={() => changeTheme(t.id)} className={`interactive seg-pill ${theme === t.id ? 'active' : ''}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <SectionLabel>Playback</SectionLabel>
          <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <Row
              icon={<SkipForward size={18} />}
              title="Autoplay Next Episode"
              text="Continue to the next episode when one ends"
              onClick={() => update({ autoplayNext: !prefs.autoplayNext })}
              trailing={<div className={`toggle-switch ${prefs.autoplayNext ? 'on' : ''}`}><div className="knob" /></div>}
            />
          </div>
        </section>

        <section>
          <SectionLabel>Data</SectionLabel>
          <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <Row
              icon={<Database size={18} />}
              title="Clear Cache"
              text={cacheCleared ? 'Cache cleared' : 'Frees stored lists and artwork data'}
              onClick={() => { clearPersistedCache(); setCacheCleared(true); }}
              trailing={<Trash2 size={18} color="var(--text-muted)" />}
            />
            <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <Row
                icon={<Trash2 size={18} />}
                title="Clear Watch History"
                text={`${historyCount} ${historyCount === 1 ? 'item' : 'items'} stored`}
                onClick={() => setConfirming(true)}
                danger
                trailing={<Trash2 size={18} color="var(--text-muted)" />}
              />
            </div>
          </div>
        </section>

        <section>
          <SectionLabel>About</SectionLabel>
          <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', padding: '16px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>CineStream</h4>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>Version {__APP_VERSION__}</p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px', lineHeight: 1.5 }}>
              Movie and TV metadata from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
            </p>
          </div>
        </section>
      </div>

      <ConfirmModal
        open={confirming}
        title="Clear Watch History"
        message="Are you sure you want to clear your watch history? This cannot be undone."
        confirmLabel="Clear"
        cancelLabel="Cancel"
        danger
        onConfirm={() => { clearWatchHistory(); setHistoryCount(0); setConfirming(false); }}
        onCancel={() => setConfirming(false)}
      />

      <TelegramAuthModal
        open={telegramAuthOpen}
        onClose={() => setTelegramAuthOpen(false)}
        onSuccess={refreshTgStatus}
      />
    </div>
  );
};
