// BottomNav.tsx - Mobile bottom navigation dock
import React from 'react';
import { Home, Compass, Search, Bookmark, Settings } from 'lucide-react';

interface BottomNavProps {
  currentTab: 'home' | 'explore' | 'search' | 'library' | 'settings';
  onNavigate: (tab: 'home' | 'explore' | 'search' | 'library' | 'settings') => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onNavigate }) => {
  return (
    <nav className="bottom-dock">
      <button
        onClick={() => onNavigate('home')}
        className={`dock-btn interactive ${currentTab === 'home' ? 'active' : ''}`}
      >
        <Home size={20} />
        <span>Home</span>
      </button>

      <button
        onClick={() => onNavigate('explore')}
        className={`dock-btn interactive ${currentTab === 'explore' ? 'active' : ''}`}
      >
        <Compass size={20} />
        <span>Explore</span>
      </button>

      <button
        onClick={() => onNavigate('search')}
        className={`dock-btn interactive ${currentTab === 'search' ? 'active' : ''}`}
      >
        <Search size={20} />
        <span>Search</span>
      </button>

      <button
        onClick={() => onNavigate('library')}
        className={`dock-btn interactive ${currentTab === 'library' ? 'active' : ''}`}
      >
        <Bookmark size={20} />
        <span>Library</span>
      </button>

      <button
        onClick={() => onNavigate('settings')}
        className={`dock-btn interactive ${currentTab === 'settings' ? 'active' : ''}`}
      >
        <Settings size={20} />
        <span>Settings</span>
      </button>
    </nav>
  );
};
