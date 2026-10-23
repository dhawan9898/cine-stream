// App.tsx - Main CineStream App Navigation & State Machine
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { BottomNav } from './components/BottomNav.tsx';
import { HomeScreen } from './pages/HomeScreen.tsx';
import { ExploreScreen } from './pages/ExploreScreen.tsx';
import { SearchScreen } from './pages/SearchScreen.tsx';
import { LibraryScreen } from './pages/LibraryScreen.tsx';
import { SettingsScreen } from './pages/SettingsScreen.tsx';
import { MediaDetailScreen } from './pages/MediaDetailScreen.tsx';
import { VideoPlayer } from './components/VideoPlayer.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import type { MediaItem, EpisodeItem } from './core/cineHypeCore.ts';
import { getSavedTheme, applyTheme } from './services/themeService.ts';

type NavigationTab = 'home' | 'explore' | 'search' | 'library' | 'settings';

interface ActivePlayerState {
  media: MediaItem;
  season?: number;
  episode?: number;
  episodeList?: EpisodeItem[];
}

export const App: React.FC = () => {
  const [tab, setTab] = useState<NavigationTab>('home');
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [activePlayer, setActivePlayer] = useState<ActivePlayerState | null>(null);

  // Initialize theme
  useEffect(() => {
    applyTheme(getSavedTheme());
  }, []);

  // Back stack handling. History is the single source of truth: every in-app
  // "back" calls history.back(), and popstate decides what is on screen.
  const detailStack = useRef<MediaItem[]>([]);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    const handlePopState = () => {
      const state = window.history.state as { screen?: string; depth?: number } | null;
      if (state?.screen === 'player') return;
      setActivePlayer(null);
      if (state?.screen === 'detail') {
        const media = detailStack.current[(state.depth ?? 1) - 1];
        if (media) {
          detailStack.current = detailStack.current.slice(0, state.depth);
          setSelectedMedia(media);
        } else {
          window.history.back(); // stale entry left over from a tab switch
        }
        return;
      }
      detailStack.current = [];
      setSelectedMedia(null);
      if (tabRef.current !== 'home') setTab('home');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleOpenDetails = useCallback((media: MediaItem) => {
    detailStack.current = [...detailStack.current, media];
    setSelectedMedia(media);
    window.history.pushState({ screen: 'detail', depth: detailStack.current.length }, '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleBackFromDetails = useCallback(() => {
    if (window.history.state?.screen === 'detail') {
      window.history.back();
    } else {
      setSelectedMedia(null);
    }
  }, []);

  const handleNavigate = useCallback((newTab: NavigationTab) => {
    detailStack.current = [];
    setSelectedMedia(null);
    setTab(newTab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

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
    if (window.history.state?.screen === 'player') {
      window.history.back();
    } else {
      setActivePlayer(null);
    }
  }, []);

  const handleSelectEpisodeInPlayer = useCallback((ep: EpisodeItem) => {
    if (!activePlayer) return;
    setActivePlayer(prev => prev ? {
      ...prev,
      episode: ep.episodeNumber
    } : null);
  }, [activePlayer]);

  return (
    <ErrorBoundary>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {/* Top App Header */}
        <Navbar
          currentTab={tab}
          onNavigate={handleNavigate}
          onOpenSearch={() => handleNavigate('search')}
        />

        {/* Main Content View */}
        <main
          key={selectedMedia ? `detail-${selectedMedia.id}` : tab}
          className={selectedMedia ? 'screen-enter-detail' : 'screen-enter'}
          style={{ flex: 1 }}
        >
          {selectedMedia ? (
            <MediaDetailScreen
              media={selectedMedia}
              onBack={handleBackFromDetails}
              onPlay={handlePlayMedia}
              onSelectMedia={handleOpenDetails}
            />
          ) : (
            <>
              {tab === 'home' && (
                <HomeScreen
                  onSelectMedia={handleOpenDetails}
                  onPlayMedia={handlePlayMedia}
                  onOpenExplore={() => setTab('explore')}
                />
              )}
              {tab === 'explore' && (
                <ExploreScreen onSelectMedia={handleOpenDetails} />
              )}
              {tab === 'search' && (
                <SearchScreen onSelectMedia={handleOpenDetails} />
              )}
              {tab === 'library' && (
                <LibraryScreen
                  onPlayMedia={handlePlayMedia}
                  onSelectMedia={handleOpenDetails}
                  onOpenExplore={() => setTab('explore')}
                />
              )}
              {tab === 'settings' && <SettingsScreen />}
            </>
          )}
        </main>

        {/* Mobile Navigation Dock */}
        <BottomNav
          currentTab={tab}
          onNavigate={handleNavigate}
        />

        {/* Fullscreen Video Player (When active) */}
        {activePlayer && (
          <VideoPlayer
            media={activePlayer.media}
            season={activePlayer.season}
            episode={activePlayer.episode}
            episodeList={activePlayer.episodeList}
            onBack={handleClosePlayer}
            onSelectEpisode={handleSelectEpisodeInPlayer}
          />
        )}
      </div>
    </ErrorBoundary>
  );
};
