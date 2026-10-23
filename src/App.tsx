// App.tsx - Main CineStream App Navigation & State Machine
import React, { useState, useEffect, useCallback } from 'react';
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

  // Back stack handling
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (activePlayer) {
        setActivePlayer(null);
        e.preventDefault();
      } else if (selectedMedia) {
        setSelectedMedia(null);
        e.preventDefault();
      } else if (tab !== 'home') {
        setTab('home');
        e.preventDefault();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activePlayer, selectedMedia, tab]);

  const handleOpenDetails = useCallback((media: MediaItem) => {
    setSelectedMedia(media);
    window.history.pushState({ screen: 'detail', id: media.id }, '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleBackFromDetails = useCallback(() => {
    setSelectedMedia(null);
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
    setActivePlayer(null);
    if (window.history.state?.screen === 'player') {
      window.history.back();
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
          onNavigate={(newTab) => {
            setSelectedMedia(null);
            setTab(newTab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onOpenSearch={() => {
            setSelectedMedia(null);
            setTab('search');
          }}
        />

        {/* Main Content View */}
        <main style={{ flex: 1 }}>
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
          onNavigate={(newTab) => {
            setSelectedMedia(null);
            setTab(newTab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
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
