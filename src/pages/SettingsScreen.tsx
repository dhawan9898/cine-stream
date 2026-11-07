// SettingsScreen.tsx - Appearance, haptics, playback and data settings.
import React, { useState } from 'react';
import { SkipForward, Gauge, Trash2, Database, Vibrate } from 'lucide-react';
import { clearWatchHistory, getUserPreferences, saveUserPreferences, getWatchHistory } from '../services/historyService.ts';
import { getSavedTheme, applyTheme, type Theme } from '../services/themeService.ts';
import { clearPersistedCache } from '../services/persistentCache.ts';
import { ConfirmModal } from 'streamkit/ui/ConfirmModal.tsx';
import { getHapticSettings, saveHapticSettings, hapticLight, hapticMedium, hapticSelection, hapticToggle, type HapticIntensity } from '../services/hapticsService.ts';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'obsidian', label: 'OLED' },
  { id: 'slate', label: 'Slate' },
  { id: 'light', label: 'Light' }
];

const PLAYBACK_LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi' }, { code: 'te', label: 'Telugu' },
  { code: 'ta', label: 'Tamil' }, { code: 'ml', label: 'Malayalam' }, { code: 'kn', label: 'Kannada' }
];

const LangChips: React.FC<{ title: string; hint: string; offLabel: string; value: string; onChange: (code: string) => void }> = ({ title, hint, offLabel, value, onChange }) => (
  <div style={{ padding: '14px 16px' }}>
    <h4 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h4>
    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 10px' }}>{hint}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {[{ code: '', label: offLabel }, ...PLAYBACK_LANGS].map(l => (
        <button key={l.code} onClick={() => onChange(l.code)} className={`interactive seg-pill ${value === l.code ? 'active' : ''}`} style={{ flex: '0 0 auto', padding: '6px 12px' }}>
          {l.label}
        </button>
      ))}
    </div>
  </div>
);

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
  <div onClick={() => { hapticLight(); onClick(); }} className="interactive" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px' }}>
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
  const [haptics, setHaptics] = useState(getHapticSettings);
  const [historyCount, setHistoryCount] = useState(() => getWatchHistory().length);
  const [confirming, setConfirming] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  const update = (patch: Partial<typeof prefs>) => {
    saveUserPreferences(patch);
    setPrefs(getUserPreferences());
  };

  const changeTheme = (t: Theme) => {
    applyTheme(t);
    setTheme(t);
    saveUserPreferences({ theme: t });
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
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>Settings</h1>
        </div>
      </div>

      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <section>
          <SectionLabel>Appearance</SectionLabel>
          <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', padding: '16px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>Theme</h4>
            <div className="seg-track">
              {THEMES.map(t => (
                <button key={t.id} onClick={() => { hapticSelection(); changeTheme(t.id); }} className={`interactive seg-pill ${theme === t.id ? 'active' : ''}`}>
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
            <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <Row
                icon={<Gauge size={18} />}
                title="Data Saver"
                text="Limit video to 720p on mobile data"
                onClick={() => update({ dataSaver: !prefs.dataSaver })}
                trailing={<div className={`toggle-switch ${prefs.dataSaver ? 'on' : ''}`}><div className="knob" /></div>}
              />
            </div>
            <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <LangChips title="Preferred Audio" hint="Used when a title offers several languages" offLabel="Auto" value={prefs.audioLanguage} onChange={code => update({ audioLanguage: code })} />
            </div>
            <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <LangChips title="Subtitles" hint="Turned on automatically when available" offLabel="Off" value={prefs.subtitleLanguage} onChange={code => update({ subtitleLanguage: code })} />
            </div>
          </div>
        </section>

        <section>
          <SectionLabel>Haptic Feedback</SectionLabel>
          <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <Row
              icon={<Vibrate size={18} />}
              title="Vibration"
              text="Short vibrations when you tap, switch or confirm something."
              onClick={() => { const next = !haptics.enabled; setHaptics(saveHapticSettings({ enabled: next })); hapticToggle(next); }}
              trailing={<div className={`toggle-switch ${haptics.enabled ? 'on' : ''}`}><div className="knob" /></div>}
            />
            <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '14px 16px', opacity: haptics.enabled ? 1 : 0.45 }}>
              <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>Intensity</h4>
              <div className="seg-track">
                {(['low', 'medium', 'high'] as HapticIntensity[]).map(level => (
                  <button
                    key={level}
                    disabled={!haptics.enabled}
                    onClick={() => { setHaptics(saveHapticSettings({ intensity: level })); hapticMedium(); }}
                    className={`interactive seg-pill ${haptics.intensity === level ? 'active' : ''}`}
                  >
                    {level === 'low' ? 'Low' : level === 'medium' ? 'Medium' : 'High'}
                  </button>
                ))}
              </div>
            </div>
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

    </div>
  );
};
