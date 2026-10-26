// App.tsx - CineStream shell: four tabs that stay mounted (state and scroll
// position are kept), title/browse pages that slide over them, a floating
// glass dock, and the player.
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Home, Search, Library, Settings } from 'lucide-react';
import { HomeScreen } from './pages/HomeScreen.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import type { MediaItem, EpisodeItem } from './core/cineHypeCore.ts';
import type { BrowseSource } from './services/browseSources.ts';
import { getSavedTheme, applyTheme } from './services/themeService.ts';
import { handleLayerBack } from './services/backStack.ts';
import { useTvNavigation } from './services/tvNavigationService.ts';

// Everything except Home is loaded on demand so the first paint ships less JS;
// the player chunk also carries hls.js.
const SearchScreen = lazy(() => import('./pages/SearchScreen.tsx').then(m => ({ default: m.SearchScreen })));
const LibraryScreen = lazy(() => import('./pages/LibraryScreen.tsx').then(m => ({ default: m.LibraryScreen })));
const SettingsScreen = lazy(() => import('./pages/SettingsScreen.tsx').then(m => ({ default: m.SettingsScreen })));
const MediaDetailScreen = lazy(() => import('./pages/MediaDetailScreen.tsx').then(m => ({ default: m.MediaDetailScreen })));
const BrowseScreen = lazy(() => import('./pages/BrowseScreen.tsx').then(m => ({ default: m.BrowseScreen })));
const VideoPlayer = lazy(() => import('./components/VideoPlayer.tsx').then(m => ({ default: m.VideoPlayer })));

type Tab = 'home' | 'search' | 'library' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'settings', label: 'Settings', icon: Settings }
];

type NewLayer =
  | { kind: 'detail'; media: MediaItem }
  | { kind: 'browse'; source: BrowseSource };
type Layer = NewLayer & { id: string };

interface ActivePlayerState {
  media: MediaItem;
  season?: number;
  episode?: number;
  episodeList?: EpisodeItem[];
}

const SLIDE_OUT_MS = 240;
let layerSeq = 0;

export const App: React.FC = () => {
  const [tab, setTab] = useState<Tab>('home');
  const [mounted, setMounted] = useState<Record<Tab, boolean>>({ home: true, search: false, library: false, settings: false });
  const [layers, setLayers] = useState<Layer[]>([]);
  const [closing, setClosing] = useState<Layer[]>([]);
  const [activePlayer, setActivePlayer] = useState<ActivePlayerState | null>(null);

  // Enable Android TV & Keyboard Remote D-Pad spatial navigation
  useTvNavigation(true);

  useEffect(() => {
    applyTheme(getSavedTheme());
  }, []);

  // History is the single source of truth for back: every in-app "back" calls
  // history.back() and popstate decides what stays on screen.
  const layersRef = useRef<Layer[]>([]);
  layersRef.current = layers;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const dropLayers = useCallback((keep: number) => {
    const removed = layersRef.current.slice(keep);
    if (removed.length === 0) return;
    setLayers(layersRef.current.slice(0, keep));
    setClosing(prev => [...prev, ...removed]);
    window.setTimeout(() => {
      setClosing(prev => prev.filter(l => !removed.includes(l)));
    }, SLIDE_OUT_MS);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const state = window.history.state as { screen?: string; depth?: number } | null;
      if (state?.screen === 'player') return;
      setActivePlayer(null);
      if (state?.screen === 'layer') {
        const depth = state.depth ?? 0;
        if (depth > layersRef.current.length) {
          window.history.back(); // stale entry left over from a tab switch
          return;
        }
        dropLayers(depth);
        return;
      }
      dropLayers(0);
      if (tabRef.current !== 'home') setTab('home');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [dropLayers]);

  const pushLayer = useCallback((layer: NewLayer) => {
    const next: Layer = { ...layer, id: `layer-${++layerSeq}` };
    const stack = [...layersRef.current, next];
    setLayers(stack);
    window.history.pushState({ screen: 'layer', depth: stack.length }, '');
  }, []);

  const openDetails = useCallback((media: MediaItem) => pushLayer({ kind: 'detail', media }), [pushLayer]);
  const openSource = useCallback((source: BrowseSource) => pushLayer({ kind: 'browse', source }), [pushLayer]);

  const closeTopLayer = useCallback(() => {
    if (window.history.state?.screen === 'layer') window.history.back();
    else dropLayers(layersRef.current.length - 1);
  }, [dropLayers]);

  const switchTab = useCallback((next: Tab) => {
    dropLayers(0);
    setMounted(prev => (prev[next] ? prev : { ...prev, [next]: true }));
    setTab(next);
  }, [dropLayers]);

  const handlePlayMedia = useCallback((
    media: MediaItem,
    season: number = 1,
    episode: number = 1,
    episodeList: EpisodeItem[] = []
  ) => {
    setActivePlayer({ media, season, episode, episodeList });
    window.history.pushState({ screen: 'player', id: media.id }, '');
  }, []);

  const handleClosePlayer = useCallback(() => {
    if (window.history.state?.screen === 'player') window.history.back();
    else setActivePlayer(null);
  }, []);

  const handleSelectEpisodeInPlayer = useCallback((ep: EpisodeItem) => {
    setActivePlayer(prev => prev ? { ...prev, episode: ep.episodeNumber, season: ep.seasonNumber ?? prev.season } : null);
  }, []);

  // Android back. The native shell asks us what "back" means by calling
  // window.__cinestreamBack(): it closes the top-most thing (a panel, the
  // player, a title/browse page, or a tab -> Home) and returns true. Only on
  // Home (nothing left to close) does the app go to the background.
  const backStepRef = useRef<() => boolean>(() => false);
  backStepRef.current = () => {
    if (handleLayerBack()) return true;
    if (activePlayer) { handleClosePlayer(); return true; }
    if (layersRef.current.length > 0) { closeTopLayer(); return true; }
    if (tab !== 'home') { switchTab('home'); return true; }
    return false;
  };
  useEffect(() => {
    const w = window as unknown as { __cinestreamBack?: () => boolean };
    w.__cinestreamBack = () => backStepRef.current();
    return () => { delete w.__cinestreamBack; };
  }, []);

  // Screens underneath a covering layer (or the player) stop animating.
  const covered = layers.length > 0 || activePlayer !== null;
  const dockHidden = activePlayer !== null || layers.some(l => l.kind === 'detail');

  const renderLayer = (layer: Layer, leaving: boolean) => (
    <div key={layer.id} className={leaving ? 'overlay leaving' : 'overlay'}>
      {layer.kind === 'detail' ? (
        <MediaDetailScreen
          media={layer.media}
          onBack={leaving ? () => undefined : closeTopLayer}
          onPlay={leaving ? () => undefined : handlePlayMedia}
          onSelectMedia={leaving ? () => undefined : openDetails}
        />
      ) : (
        <BrowseScreen
          source={layer.source}
          onBack={leaving ? () => undefined : closeTopLayer}
          onOpenSource={leaving ? () => undefined : openSource}
          onSelectMedia={leaving ? () => undefined : openDetails}
        />
      )}
    </div>
  );

  const pane = (id: Tab, node: React.ReactNode) => (
    mounted[id] ? (
      <div key={id} className="tab-pane" data-active={tab === id}>
        <Suspense fallback={<div className="skeleton" style={{ flex: 1, borderRadius: 0 }} />}>{node}</Suspense>
      </div>
    ) : null
  );

  return (
    <ErrorBoundary>
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-main)', overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {pane('home', (
            <HomeScreen
              onSelectMedia={openDetails}
              onPlayMedia={handlePlayMedia}
              onOpenSearch={() => switchTab('search')}
              onOpenSource={openSource}
              paused={covered || tab !== 'home'}
            />
          ))}
          {pane('search', (
            <SearchScreen
              active={tab === 'search' && !covered}
              onBack={() => switchTab('home')}
              onSelectMedia={openDetails}
            />
          ))}
          {pane('library', <LibraryScreen onPlayMedia={handlePlayMedia} onSelectMedia={openDetails} />)}
          {pane('settings', <SettingsScreen />)}

          <Suspense fallback={null}>
            {layers.map(l => renderLayer(l, false))}
            {closing.map(l => renderLayer(l, true))}
          </Suspense>
        </div>

        {/* Floating glass dock: slides away over a title page or the player. */}
        <div
          className={dockHidden ? 'dock-wrap hidden' : 'dock-wrap'}
          style={{ bottom: 'calc(16px + var(--safe-bottom))' }}
          aria-hidden={dockHidden}
        >
          <nav className="glass-dock" aria-label="Main">
            <div
              className="dock-indicator"
              style={{
                width: `${100 / TABS.length}%`,
                transform: `translateX(${TABS.findIndex(t => t.id === tab) * 100}%)`
              }}
            />
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => { if (!active || layers.length) switchTab(id); }}
                  className={`interactive dock-item ${active ? 'active' : ''}`}
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={20} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {activePlayer && (
          <Suspense fallback={<div className="netflix-player-container" />}>
            <VideoPlayer
              media={activePlayer.media}
              season={activePlayer.season}
              episode={activePlayer.episode}
              episodeList={activePlayer.episodeList}
              onBack={handleClosePlayer}
              onSelectEpisode={handleSelectEpisodeInPlayer}
            />
          </Suspense>
        )}
      </div>
    </ErrorBoundary>
  );
};
