// BottomNav.tsx - Floating liquid-glass dock with a sliding selection pane
import React from 'react';
import { Home, Compass, Search, Bookmark, Settings } from 'lucide-react';

type Tab = 'home' | 'explore' | 'search' | 'library' | 'settings';

interface BottomNavProps {
  currentTab: Tab;
  onNavigate: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'library', label: 'Library', icon: Bookmark },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onNavigate }) => (
  <nav className="bottom-dock" aria-label="Main">
    <div
      className="dock-indicator"
      style={{
        width: `${100 / TABS.length}%`,
        transform: `translateX(${TABS.findIndex(t => t.id === currentTab) * 100}%)`
      }}
    />
    {TABS.map(({ id, label, icon: Icon }) => {
      const active = currentTab === id;
      return (
        <button
          key={id}
          onClick={() => onNavigate(id)}
          className={`dock-btn ${active ? 'active' : ''}`}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      );
    })}
  </nav>
);
