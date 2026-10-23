// Navbar.tsx - Top navigation bar with CineStream branding & liquid glass controls
import React from 'react';
import { Film, Search, Settings, Sparkles } from 'lucide-react';

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
          gap: '12px',
          cursor: 'pointer'
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: '12px',
            background: 'var(--accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--accent-glow), inset 0 1px 1px rgba(255,255,255,0.4)',
            border: '1px solid rgba(255,255,255,0.2)'
          }}
        >
          <Film size={20} color="#ffffff" />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '19px', fontWeight: 900, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
              Cine<span style={{ color: 'var(--accent-primary)' }}>Stream</span>
            </span>
            <span
              className="badge"
              style={{
                fontSize: '9px',
                fontWeight: 800,
                background: 'rgba(236, 28, 36, 0.18)',
                color: 'var(--accent-primary)',
                padding: '2px 6px',
                borderRadius: '6px',
                border: '1px solid rgba(236, 28, 36, 0.35)',
                boxShadow: '0 0 12px rgba(236, 28, 36, 0.25)'
              }}
            >
              CINEHYPE
            </span>
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1, marginTop: '2px' }}>
            Movies & TV Shows
          </div>
        </div>
      </div>

      {/* Center Links (Desktop only) */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(255, 255, 255, 0.04)',
          padding: '4px 6px',
          borderRadius: 'var(--radius-full)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.1)'
        }}
        className="desktop-nav"
      >
        <button
          onClick={() => onNavigate('home')}
          className="interactive"
          style={{
            background: currentTab === 'home' ? 'var(--accent-gradient)' : 'transparent',
            border: currentTab === 'home' ? '1px solid rgba(255, 255, 255, 0.25)' : 'none',
            color: currentTab === 'home' ? '#ffffff' : 'var(--text-muted)',
            fontSize: '13px',
            fontWeight: 700,
            padding: '7px 16px',
            borderRadius: 'var(--radius-full)',
            boxShadow: currentTab === 'home' ? 'var(--accent-glow)' : 'none'
          }}
        >
          Home
        </button>

        <button
          onClick={() => onNavigate('explore')}
          className="interactive"
          style={{
            background: currentTab === 'explore' ? 'var(--accent-gradient)' : 'transparent',
            border: currentTab === 'explore' ? '1px solid rgba(255, 255, 255, 0.25)' : 'none',
            color: currentTab === 'explore' ? '#ffffff' : 'var(--text-muted)',
            fontSize: '13px',
            fontWeight: 700,
            padding: '7px 16px',
            borderRadius: 'var(--radius-full)',
            boxShadow: currentTab === 'explore' ? 'var(--accent-glow)' : 'none'
          }}
        >
          Explore
        </button>

        <button
          onClick={() => onNavigate('library')}
          className="interactive"
          style={{
            background: currentTab === 'library' ? 'var(--accent-gradient)' : 'transparent',
            border: currentTab === 'library' ? '1px solid rgba(255, 255, 255, 0.25)' : 'none',
            color: currentTab === 'library' ? '#ffffff' : 'var(--text-muted)',
            fontSize: '13px',
            fontWeight: 700,
            padding: '7px 16px',
            borderRadius: 'var(--radius-full)',
            boxShadow: currentTab === 'library' ? 'var(--accent-glow)' : 'none'
          }}
        >
          My Library
        </button>
      </nav>

      {/* Right Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          onClick={onOpenSearch}
          className="interactive liquid-pill"
          style={{
            gap: '8px',
            padding: '7px 16px',
            color: 'var(--text-secondary)',
            fontSize: '13px'
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
            background: currentTab === 'settings' ? 'rgba(236, 28, 36, 0.2)' : 'rgba(255, 255, 255, 0.08)',
            border: currentTab === 'settings' ? '1px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.16)',
            boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.25)',
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
