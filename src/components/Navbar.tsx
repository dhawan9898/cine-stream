// Navbar.tsx - Top navigation bar with CineStream branding & controls
import React from 'react';
import { Film, Search, Bookmark, Compass, Settings, Sparkles } from 'lucide-react';

interface NavbarProps {
  currentTab: 'home' | 'explore' | 'search' | 'library' | 'settings';
  onNavigate: (tab: 'home' | 'explore' | 'search' | 'library' | 'settings') => void;
  onOpenSearch: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onNavigate,
  onOpenSearch
}) => {
  return (
    <header className="top-bar">
      {/* Brand Logo */}
      <div
        onClick={() => onNavigate('home')}
        className="interactive"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          cursor: 'pointer'
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '10px',
            background: 'var(--accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--accent-glow)'
          }}
        >
          <Film size={20} color="#ffffff" />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
              Cine<span style={{ color: 'var(--accent-primary)' }}>Stream</span>
            </span>
            <span
              style={{
                fontSize: '9px',
                fontWeight: 800,
                background: 'rgba(236, 28, 36, 0.15)',
                color: 'var(--accent-primary)',
                padding: '2px 5px',
                borderRadius: '4px',
                border: '1px solid rgba(236, 28, 36, 0.3)'
              }}
            >
              CINEHYPE
            </span>
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1 }}>
            Movies & TV Shows
          </div>
        </div>
      </div>

      {/* Center Links (Desktop only) */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}
        className="desktop-nav"
      >
        <button
          onClick={() => onNavigate('home')}
          className={`interactive ${currentTab === 'home' ? 'active' : ''}`}
          style={{
            background: currentTab === 'home' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
            border: 'none',
            color: currentTab === 'home' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontSize: '13px',
            fontWeight: 700,
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)'
          }}
        >
          Home
        </button>

        <button
          onClick={() => onNavigate('explore')}
          className={`interactive ${currentTab === 'explore' ? 'active' : ''}`}
          style={{
            background: currentTab === 'explore' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
            border: 'none',
            color: currentTab === 'explore' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontSize: '13px',
            fontWeight: 700,
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)'
          }}
        >
          Explore
        </button>

        <button
          onClick={() => onNavigate('library')}
          className={`interactive ${currentTab === 'library' ? 'active' : ''}`}
          style={{
            background: currentTab === 'library' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
            border: 'none',
            color: currentTab === 'library' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontSize: '13px',
            fontWeight: 700,
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)'
          }}
        >
          My Library
        </button>
      </nav>

      {/* Right Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          onClick={onOpenSearch}
          className="interactive"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(255, 255, 255, 0.07)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-full)',
            padding: '7px 16px',
            color: 'var(--text-secondary)',
            fontSize: '13px',
            fontWeight: 500
          }}
        >
          <Search size={16} color="var(--accent-primary)" />
          <span className="search-text">Search titles, actors...</span>
        </button>

        <button
          onClick={() => onNavigate('settings')}
          className="interactive"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: currentTab === 'settings' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.07)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: currentTab === 'settings' ? 'var(--accent-primary)' : 'var(--text-secondary)'
          }}
          aria-label="Settings"
        >
          <Settings size={18} />
        </button>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .search-text { display: none !important; }
        }
      `}</style>
    </header>
  );
};
