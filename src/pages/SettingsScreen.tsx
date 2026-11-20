// SettingsScreen.tsx - Laid out like AniStream's and Mangapill's: Appearance, Playback, Sources,
// Downloads, Haptic Feedback, Data, About (with updates and stream diagnostics).
import React, { useState, useEffect, useRef } from 'react';
import { SkipForward, Gauge, Database, Vibrate, Droplets, Zap, Bookmark, ChevronRight, ChevronDown, Server, KeyRound, RefreshCw, DownloadCloud, Bug, Upload, Download, Clock, Captions, AudioLines, Film, Info, Activity } from 'lucide-react';
import { SettingsSection, SettingsRow, ChoiceRow, Switch, RowValue, SettingsNote, UpdateRows } from 'streamkit/ui/Settings.tsx';
import { CategoryPicker } from 'streamkit/ui/CategoryPicker.tsx';
import { clearWatchHistory, clearBookmarks, getBookmarks, getUserPreferences, saveUserPreferences, getWatchHistory, getEpisodeLogCount, exportBackup, importBackup, subscribeLibraryChanges } from '../services/historyService.ts';
import { Capacitor } from '@capacitor/core';
import { AccountAvatarButton } from '../components/AccountAvatarButton.tsx';
import { DownloadsPlugin } from '../plugins/downloadsPlugin.ts';
import { getSavedTheme, applyTheme, type Theme } from '../services/themeService.ts';
import { clearAllCaches } from '../services/cacheService.ts';
import { ConfirmModal } from 'streamkit/ui/ConfirmModal.tsx';
import { getGlassStyle, setGlassStyle } from '../services/glassService.ts';
import { getHapticSettings, saveHapticSettings, hapticLight, hapticMedium, hapticSelection, hapticToggle, type HapticIntensity } from '../services/hapticsService.ts';
import { checkForUpdate, installUpdate } from '../services/updateService.ts';
import { testJellyfinConnection, streamStoreSize, clearTimings, formatTimingReport, summarize } from '../providers/index.ts';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'obsidian', label: 'OLED' },
  { id: 'slate', label: 'Slate' },
  { id: 'light', label: 'Light' }
];

const QUALITIES = [
  { id: 'Auto', label: 'Auto' }, { id: '1080p', label: '1080p' }, { id: '720p', label: '720p' }, { id: '480p', label: '480p' }
] as const;
const DOWNLOAD_QUALITIES = [{ id: '1080', label: '1080p' }, { id: '720', label: '720p' }, { id: '480', label: '480p' }] as const;
const HAPTIC_LEVELS: readonly { id: HapticIntensity; label: string }[] = [
  { id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }
];

const PLAYBACK_LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi' }, { code: 'te', label: 'Telugu' },
  { code: 'ta', label: 'Tamil' }, { code: 'ml', label: 'Malayalam' }, { code: 'kn', label: 'Kannada' }
];

// One row per language setting: its current value; tapping opens the list.
const LangRow: React.FC<{ icon: React.ReactNode; title: string; hint: string; offLabel: string; value: string; onChange: (code: string) => void }> = ({ icon, title, hint, offLabel, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const options = [{ code: '', label: offLabel }, ...PLAYBACK_LANGS];
  const current = options.find(o => o.code === value)?.label ?? offLabel;
  return (
    <>
      <SettingsRow
        icon={icon}
        title={title}
        hint={hint}
        onClick={() => { hapticLight(); setOpen(true); }}
        trailing={<><RowValue>{current}</RowValue><ChevronRight size={16} color="var(--text-muted)" /></>}
      />
      <CategoryPicker
        open={open}
        presentation="card"
        title={title}
        sections={[{ items: options.map(o => ({ key: o.code || 'off', name: o.label })) }]}
        selectedKey={value || 'off'}
        onSelect={key => { hapticSelection(); setOpen(false); onChange(key === 'off' ? '' : key); }}
        onClose={() => setOpen(false)}
      />
    </>
  );
};

export const SettingsScreen: React.FC = () => {
  const [prefs, setPrefs] = useState(getUserPreferences());
  const [theme, setTheme] = useState<Theme>(getSavedTheme());
  const [haptics, setHaptics] = useState(getHapticSettings);
  const [glassClear, setGlassClear] = useState(() => getGlassStyle() === 'clear');
  const [historyCount, setHistoryCount] = useState(() => getWatchHistory().length);
  const [episodeCount, setEpisodeCount] = useState(() => getEpisodeLogCount());
  const [confirming, setConfirming] = useState(false);
  const [confirmingBookmarks, setConfirmingBookmarks] = useState(false);
  const [bookmarkCount, setBookmarkCount] = useState(() => getBookmarks().length);
  const [cacheState, setCacheState] = useState<'idle' | 'clearing' | 'cleared'>('idle');
  const [linkCount, setLinkCount] = useState(() => streamStoreSize());
  const [timings, setTimings] = useState(() => summarize());
  const [reportCopied, setReportCopied] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showJellyfin, setShowJellyfin] = useState(false);
  const [jfUrl, setJfUrl] = useState(() => getUserPreferences().jellyfinUrl ?? '');
  const [jfKey, setJfKey] = useState(() => getUserPreferences().jellyfinApiKey ?? '');
  const [jfStatus, setJfStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [jfTesting, setJfTesting] = useState(false);

  // Keep counts in sync whenever history or bookmarks change across tabs/player
  useEffect(() => {
    return subscribeLibraryChanges(() => {
      setHistoryCount(getWatchHistory().length);
      setEpisodeCount(getEpisodeLogCount());
      setBookmarkCount(getBookmarks().length);
    });
  }, []);

  // Crash reporting & backup
  const [crashReport, setCrashReport] = useState<string | null>(null);
  const [crashCopied, setCrashCopied] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    DownloadsPlugin.getCrashReport().then(res => {
      if (res.report) setCrashReport(res.report);
    }).catch(() => {});
  }, []);

  const handleCopyClearCrash = async () => {
    if (!crashReport) return;
    try {
      await navigator.clipboard.writeText(crashReport);
      await DownloadsPlugin.clearCrashReport();
      setCrashReport(null);
      setCrashCopied(true);
      setTimeout(() => setCrashCopied(false), 3000);
    } catch {}
  };

  const handleExportBackup = async () => {
    try {
      const json = exportBackup();
      const name = `cinestream-backup-${new Date().toISOString().slice(0, 10)}.json`;
      if (Capacitor.isNativePlatform()) {
        // A file link clicked inside the app's WebView saves nothing: the file is written natively.
        const { location } = await DownloadsPlugin.saveTextFile({ name, text: json });
        setBackupStatus(`Backup saved to ${location}`);
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        setBackupStatus('Backup exported');
      }
      setTimeout(() => setBackupStatus(null), 6000);
    } catch (err) {
      setBackupStatus(`Export failed: ${err instanceof Error ? err.message : 'Error'}`);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        importBackup(text);
        setHistoryCount(getWatchHistory().length);
        setEpisodeCount(getEpisodeLogCount());
        setBookmarkCount(getBookmarks().length);
        setPrefs(getUserPreferences());
        setBackupStatus('Backup imported successfully');
        setTimeout(() => setBackupStatus(null), 3000);
      } catch (err: any) {
        setBackupStatus(`Import failed: ${err?.message || 'Invalid format'}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const saveJellyfin = () => {
    update({ jellyfinUrl: jfUrl.trim(), jellyfinApiKey: jfKey.trim() });
    setJfStatus(null);
  };
  const testJellyfin = async () => {
    saveJellyfin();
    setJfTesting(true);
    setJfStatus(await testJellyfinConnection());
    setJfTesting(false);
  };

  const update = (patch: Partial<typeof prefs>) => {
    saveUserPreferences(patch);
    setPrefs(getUserPreferences());
  };

  const changeTheme = (t: Theme) => {
    applyTheme(t);
    setTheme(t);
    saveUserPreferences({ theme: t });
  };

  const toggle = (on: boolean, change: () => void) => () => { hapticToggle(!on); change(); };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated, rgba(255,255,255,0.06))', color: 'var(--text-primary)', fontSize: '14px' };

  return (
    <div className="screen-scroll" style={{ paddingBottom: '110px' }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 30, backgroundColor: 'var(--bg-main)',
        padding: 'calc(var(--safe-top) + 16px) 20px 14px 20px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }}>
        <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>Settings</h1>
        <AccountAvatarButton />
      </div>

      <div style={{ padding: '20px 16px' }}>
        <SettingsSection title="Appearance">
          <ChoiceRow first title="Theme" options={THEMES} value={theme} onSelect={(t: Theme) => { hapticSelection(); changeTheme(t); }} />
          <SettingsRow
            icon={<Droplets size={18} />}
            title="Transparent Glass"
            hint="Bars, buttons and tiles turn see-through instead of blurred"
            onClick={toggle(glassClear, () => { const next = !glassClear; setGlassClear(next); setGlassStyle(next ? 'clear' : 'frosted'); })}
            trailing={<Switch on={glassClear} label="Transparent Glass" />}
          />
        </SettingsSection>

        <SettingsSection title="Playback">
          <ChoiceRow
            first
            title="Default Quality"
            options={QUALITIES}
            value={prefs.defaultQuality}
            onSelect={(q: string) => { hapticSelection(); update({ defaultQuality: q }); }}
          />
          <LangRow icon={<AudioLines size={18} />} title="Preferred Audio" hint="Used when a title offers several languages" offLabel="Auto" value={prefs.audioLanguage} onChange={code => update({ audioLanguage: code })} />
          <LangRow icon={<Captions size={18} />} title="Subtitles" hint="Turned on automatically when available" offLabel="Off" value={prefs.subtitleLanguage} onChange={code => update({ subtitleLanguage: code })} />
          <SettingsRow
            icon={<SkipForward size={18} />}
            title="Autoplay Next Episode"
            hint="Continue to the next episode when one ends"
            onClick={toggle(prefs.autoplayNext, () => update({ autoplayNext: !prefs.autoplayNext }))}
            trailing={<Switch on={prefs.autoplayNext} label="Autoplay Next Episode" />}
          />
          <SettingsRow
            icon={<Zap size={18} />}
            title="Faster Start"
            hint="Prepares streams in advance so Play starts at once; uses a little extra data"
            onClick={toggle(prefs.preloadStreams ?? true, () => update({ preloadStreams: !(prefs.preloadStreams ?? true) }))}
            trailing={<Switch on={prefs.preloadStreams ?? true} label="Faster Start" />}
          />
          <SettingsRow
            icon={<Gauge size={18} />}
            title="Data Saver"
            hint="Limit video to 720p on mobile data and skip preparing streams"
            onClick={toggle(prefs.dataSaver, () => update({ dataSaver: !prefs.dataSaver }))}
            trailing={<Switch on={prefs.dataSaver} label="Data Saver" />}
          />
        </SettingsSection>

        <SettingsSection title="Sources">
          <SettingsRow
            first
            icon={<KeyRound size={18} />}
            title="FlixHQ Decrypt Service"
            hint="Faster FlixHQ streams through a third-party service, which sees the links you play"
            onClick={toggle(prefs.flixhqDecryptApi, () => update({ flixhqDecryptApi: !prefs.flixhqDecryptApi }))}
            trailing={<Switch on={prefs.flixhqDecryptApi} label="FlixHQ Decrypt Service" />}
          />
          <SettingsRow
            icon={<Server size={18} />}
            title="Your Jellyfin Server"
            hint={prefs.jellyfinUrl ? prefs.jellyfinUrl : 'Play titles from your own library first'}
            onClick={() => { hapticLight(); setShowJellyfin(v => !v); }}
            trailing={showJellyfin ? <ChevronDown size={16} color="var(--text-muted)" /> : <ChevronRight size={16} color="var(--text-muted)" />}
          />
          {showJellyfin && (
            <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Use its https:// address (Android blocks plain http) and an API key from Dashboard &gt; API Keys.
              </p>
              <input
                type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                placeholder="https://jellyfin.example.com" value={jfUrl}
                onChange={e => setJfUrl(e.target.value)} onBlur={saveJellyfin} style={inputStyle}
              />
              <input
                type="password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                placeholder="API key" value={jfKey}
                onChange={e => setJfKey(e.target.value)} onBlur={saveJellyfin} style={inputStyle}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button onClick={() => { hapticLight(); void testJellyfin(); }} disabled={jfTesting} className="interactive seg-pill" style={{ flex: '0 0 auto', padding: '8px 16px' }}>
                  {jfTesting ? 'Testing…' : 'Test Connection'}
                </button>
                {jfStatus && <span style={{ fontSize: '12px', color: jfStatus.ok ? 'var(--text-secondary)' : 'var(--accent-danger)' }}>{jfStatus.message}</span>}
              </div>
            </div>
          )}
        </SettingsSection>

        <SettingsSection title="Downloads">
          <ChoiceRow
            first
            title="Download Quality"
            hint="Highest quality saved for offline viewing. Lower uses much less storage."
            options={DOWNLOAD_QUALITIES}
            value={prefs.downloadQuality || '720'}
            onSelect={(q: string) => { hapticSelection(); update({ downloadQuality: q as '1080' | '720' | '480' }); }}
          />
        </SettingsSection>

        <SettingsSection title="Haptic Feedback">
          <SettingsRow
            first
            icon={<Vibrate size={18} />}
            title="Vibration"
            hint="Short vibrations when you tap, switch or confirm"
            onClick={() => { const next = !haptics.enabled; setHaptics(saveHapticSettings({ enabled: next })); hapticToggle(next); }}
            trailing={<Switch on={haptics.enabled} label="Vibration" />}
          />
          <ChoiceRow
            title="Intensity"
            options={HAPTIC_LEVELS}
            value={haptics.intensity}
            disabled={!haptics.enabled}
            onSelect={(level: HapticIntensity) => { setHaptics(saveHapticSettings({ intensity: level })); hapticMedium(); }}
          />
        </SettingsSection>

        <SettingsSection title="Data">
          <SettingsRow
            first
            icon={<Download size={18} />}
            title="Export Backup"
            hint="Save history, My List and settings to a file"
            onClick={() => { hapticLight(); void handleExportBackup(); }}
            trailing={<ChevronRight size={16} color="var(--text-muted)" />}
          />
          <SettingsRow
            icon={<Upload size={18} />}
            title="Import Backup"
            hint="Restore from a saved backup file"
            onClick={() => { hapticLight(); fileInputRef.current?.click(); }}
            trailing={<ChevronRight size={16} color="var(--text-muted)" />}
          />
          <SettingsRow
            icon={<Database size={18} />}
            title="Clear Cache"
            hint={cacheState === 'cleared' ? 'Cache cleared' : cacheState === 'clearing' ? 'Clearing...' : 'Frees stored lists, artwork and saved stream links. History, My List and downloads are kept.'}
            disabled={cacheState === 'clearing'}
            onClick={() => {
              hapticLight();
              setCacheState('clearing');
              void clearAllCaches().finally(() => { setLinkCount(streamStoreSize()); setCacheState('cleared'); });
            }}
            trailing={<RowValue>{linkCount} links</RowValue>}
          />
          <SettingsRow
            danger
            icon={<Clock size={18} />}
            title="Clear Watch History"
            hint="Forgets where you stopped in every title"
            disabled={historyCount === 0 && episodeCount === 0}
            onClick={() => { hapticLight(); setConfirming(true); }}
            trailing={<RowValue>{historyCount > 0 ? historyCount : episodeCount}</RowValue>}
          />
          <SettingsRow
            danger
            icon={<Bookmark size={18} />}
            title="Clear My List"
            hint="Removes every saved title"
            disabled={bookmarkCount === 0}
            onClick={() => { hapticLight(); setConfirmingBookmarks(true); }}
            trailing={<RowValue>{bookmarkCount}</RowValue>}
          />
          {crashReport && (
            <SettingsRow
              danger
              icon={<Bug size={18} />}
              title={crashCopied ? 'Crash report copied' : 'Copy Last Crash Report'}
              hint="The app closed unexpectedly earlier. Copies what happened for the developer."
              onClick={() => void handleCopyClearCrash()}
            />
          )}
          {backupStatus && <SettingsNote>{backupStatus}</SettingsNote>}
          <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
        </SettingsSection>

        <SettingsSection title="About">
          <SettingsRow
            first
            icon={<Film size={18} />}
            title="CineStream"
            hint="Movies and TV from many sources at once"
            trailing={<RowValue>v{__APP_VERSION__}</RowValue>}
          />
          <UpdateRows
            appName="CineStream"
            version={__APP_VERSION__}
            icon={<RefreshCw size={18} />}
            installIcon={<DownloadCloud size={16} />}
            check={() => checkForUpdate('dhawan9898/cine-stream')}
            install={installUpdate}
            onTap={hapticLight}
          />
          <SettingsRow
            icon={<Info size={18} />}
            title="Disclaimer"
            hint="CineStream does not host any media. Metadata from TMDB; this product uses the TMDB API but is not endorsed or certified by TMDB."
          />
          <SettingsRow
            icon={<Activity size={18} />}
            title="Stream Diagnostics"
            hint="How long each server takes to answer"
            onClick={() => { hapticLight(); setShowDiagnostics(v => !v); }}
            trailing={showDiagnostics ? <ChevronDown size={16} color="var(--text-muted)" /> : <ChevronRight size={16} color="var(--text-muted)" />}
          />
          {showDiagnostics && (
          <div style={{ padding: '0 16px 16px' }}>
            {timings.servers.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Play or browse a few titles to collect timings.</p>
            ) : timings.servers.map(s => (
              <div key={s.serverId} style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{s.serverId}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Answer: median {(s.extract.median / 1000).toFixed(2)}s, slowest 1 in 10 {(s.extract.p90 / 1000).toFixed(2)}s
                  {' '}({Object.entries(s.outcomes).map(([k, v]) => `${v} ${k}`).join(', ')})
                </div>
                {s.sniff.count > 0 && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Embed to stream: median {(s.sniff.median / 1000).toFixed(2)}s ({s.sniffed} ok, {s.sniffFailed} failed)
                    <br />WebView ready {(s.webview.median / 1000).toFixed(2)}s ({s.pooled} reused, {s.cold} new), page load {(s.page.median / 1000).toFixed(2)}s, stream request {(s.stream.median / 1000).toFixed(2)}s
                  </div>
                )}
              </div>
            ))}
            <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600, marginTop: '4px' }}>
              Whole lookup: median {(timings.lookups.stats.median / 1000).toFixed(2)}s
              {' '}({timings.lookups.ok} ok, {timings.lookups.fail} failed, {timings.lookups.cache} instant from saved links)
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button className="interactive seg-pill" style={{ flex: 1 }} onClick={() => setTimings(summarize())}>Refresh</button>
              <button
                className="interactive seg-pill"
                style={{ flex: 1 }}
                onClick={() => { navigator.clipboard?.writeText(formatTimingReport(timings)).then(() => setReportCopied(true)).catch(() => {}); }}
              >
                {reportCopied ? 'Copied' : 'Copy Report'}
              </button>
              <button className="interactive seg-pill" style={{ flex: 1 }} onClick={() => { clearTimings(); setTimings(summarize()); setReportCopied(false); }}>Reset</button>
            </div>
          </div>
          )}
        </SettingsSection>
      </div>

      <ConfirmModal
        open={confirming}
        title="Clear Watch History"
        message="Are you sure you want to clear your watch history? This cannot be undone."
        confirmLabel="Clear"
        cancelLabel="Cancel"
        danger
        onConfirm={() => { clearWatchHistory(); setHistoryCount(0); setEpisodeCount(0); setConfirming(false); }}
        onCancel={() => setConfirming(false)}
      />
      <ConfirmModal
        open={confirmingBookmarks}
        title="Clear My List"
        message="Remove all saved titles? This cannot be undone."
        confirmLabel="Clear"
        cancelLabel="Cancel"
        danger
        onConfirm={() => { clearBookmarks(); setBookmarkCount(0); setConfirmingBookmarks(false); }}
        onCancel={() => setConfirmingBookmarks(false)}
      />
    </div>
  );
};
