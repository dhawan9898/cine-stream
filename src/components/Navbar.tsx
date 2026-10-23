// Navbar.tsx - Netflix-style top bar: wordmark, text links, search and settings
import React from 'react';
import { Search, Settings } from 'lucide-react';

type Tab = 'home' | 'explore' | 'search' | 'library' | 'settings';

interface NavbarProps {
  currentTab: Tab;
  onNavigate: (tab: Tab) => void;
  onOpenSearch: () => void;
}

const LINKS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'explore', label: 'Explore' },
  { id: 'library', label: 'My Library' }
];

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onNavigate, onOpenSearch }) => (
  <header className="top-bar">
    <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
      <button
        onClick={() => onNavigate('home')}
        className="interactive"
        aria-label="CineStream home"
        style={{ background: 'none', border: 'none', display: 'flex', alignItems: 'baseline', textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}
      >
        <span style={{ fontSize: '24px', fontWeight: 900, letterSpacing: '-0.8px', color: 'var(--accent-primary)' }}>CINE</span>
        <span style={{ fontSize: '24px', fontWeight: 900, letterSpacing: '-0.8px', color: 'var(--text-primary)' }}>STREAM</span>
      </button>

      <nav className="desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
        {LINKS.map(l => (
          <button
            key={l.id}
            onClick={() => onNavigate(l.id)}
            className={`top-link ${currentTab === l.id ? 'active' : ''}`}
          >
            {l.label}
          </button>
        ))}
      </nav>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <button onClick={onOpenSearch} className={`interactive icon-glass ${currentTab === 'search' ? 'active' : ''}`} aria-label="Search">
        <Search size={18} />
      </button>
      <button onClick={() => onNavigate('settings')} className={`interactive icon-glass ${currentTab === 'settings' ? 'active' : ''}`} aria-label="Settings">
        <Settings size={18} />
      </button>
    </div>

    <style>{`@media (max-width: 768px) { .desktop-nav { display: none !important; } }`}</style>
  </header>
);
