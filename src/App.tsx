// App.tsx - CineStream shell: four tabs that stay mounted (state and scroll
// position are kept), title/browse pages that slide over them, a floating
// glass dock, and the player.
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Home, Search, Library, Settings } from 'lucide-react';
import { HomeScreen } from './pages/HomeScreen.tsx';
import { ErrorBoundary } from 'streamkit/ui/ErrorBoundary.tsx';
import { Dock, type DockTab } from 'streamkit/ui/Dock.tsx';
import type { MediaItem, EpisodeItem } from './providers/cineHypeCore.ts';
import type { BrowseSource } from './services/browseSources.ts';
import { getMediaWatchHistory, setPlaybackActive } from './services/historyService.ts';
import { getSavedTheme, applyTheme } from './services/themeService.ts';
import { handleLayerBack } from 'streamkit/core/backStack.ts';
import { useTvNavigation } from './services/tvNavigationService.ts';
import { SharedElementTransitionOverlay } from './components/SharedElementTransitionOverlay.tsx';
import { startSharedTransition } from './services/sharedTransitionService.ts';

// Everything except Home is loaded on demand so the first paint ships less JS;
// the player chunk also carries hls.js.
const SearchScreen = lazy(() => import('./pages/SearchScreen.tsx').then(m => ({ default: m.SearchScreen })));
const LibraryScreen = lazy(() => import('./pages/LibraryScreen.tsx').then(m => ({ default: m.LibraryScreen })));
const SettingsScreen = lazy(() => import('./pages/SettingsScreen.tsx').then(m => ({ default: m.SettingsScreen })));
const MediaDetailScreen = lazy(() => import('./pages/MediaDetailScreen.tsx').then(m => ({ default: m.MediaDetailScreen })));
const BrowseScreen = lazy(() => import('./pages/BrowseScreen.tsx').then(m => ({ default: m.BrowseScreen })));
const VideoPlayer = lazy(() => import('./components/VideoPlayer.tsx').then(m => ({ default: m.VideoPlayer })));

type Tab = 'home' | 'search' | 'library' | 'settings';

const TABS: DockTab<Tab>[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'settings', label: 'Settings', icon: Settings }
];

type NewLayer =
  | { kind: 'detail'; media: MediaItem }
  | { kind: 'browse'; source: BrowseSource };
// `shared`: opened by flying a poster to it (the page then only fades in; see index.css).
type Layer = NewLayer & { id: string; shared?: boolean };

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
  // While the player is open, progress saves don't re-render the screens beneath it.
  const playerOpen = activePlayer !== null;
  useEffect(() => { setPlaybackActive(playerOpen); }, [playerOpen]);

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

  const pushLayer = useCallback((layer: NewLayer, shared = false) => {
    const next: Layer = { ...layer, id: `layer-${++layerSeq}`, shared };
    const stack = [...layersRef.current, next];
    setLayers(stack);
    window.history.pushState({ screen: 'layer', depth: stack.length }, '');
  }, []);

  const openDetails = useCallback((media: MediaItem, rect?: DOMRect) => {
    if (rect) startSharedTransition(rect, { poster: media.poster, banner: media.backdrop });
    pushLayer({ kind: 'detail', media }, !!rect);
  }, [pushLayer]);

  const openSource = useCallback((source: BrowseSource) => {
    const currentStack = layersRef.current;
    const top = currentStack[currentStack.length - 1];
    // If already viewing a BrowseScreen layer, replace it in place rather than stacking duplicate browse layers.
    if (top && top.kind === 'browse') {
      const next: Layer = { kind: 'browse', source, id: `layer-${++layerSeq}` };
      const updated = [...currentStack.slice(0, -1), next];
      setLayers(updated);
      window.history.replaceState({ screen: 'layer', depth: updated.length }, '');
      return;
    }
    pushLayer({ kind: 'browse', source });
  }, [pushLayer]);

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
    season?: number,
    episode?: number,
    episodeList: EpisodeItem[] = []
  ) => {
    let resolvedSeason = season ?? 1;
    let resolvedEpisode = episode ?? 1;
    if (media.mediaType === 'tv' && season === undefined && episode === undefined) {
      const saved = getMediaWatchHistory(media.id, 'tv');
      if (saved?.season && saved?.episode) {
        resolvedSeason = saved.season;
        resolvedEpisode = saved.episode;
      }
    }
    setActivePlayer({ media, season: resolvedSeason, episode: resolvedEpisode, episodeList });
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
    <div key={layer.id} className={`overlay${leaving ? ' leaving' : ''}${layer.shared ? ' shared-open' : ''}`}>
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
    <ErrorBoundary appName="CineStream">
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
          <SharedElementTransitionOverlay />
        </div>

        {/* Floating glass dock: slides away over a title page or the player. */}
        <Dock
          tabs={TABS}
          currentTab={tab}
          hidden={dockHidden}
          hasOverlay={layers.length > 0}
          onSelect={switchTab}
          bottom="calc(16px + var(--safe-bottom))"
        />

        {activePlayer && (
          <Suspense fallback={<div className="player-state" />}>
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
