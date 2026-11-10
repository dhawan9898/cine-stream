// StreamLoading.tsx - What the viewer sees between tapping Play and the player starting.
//
// Instead of a spinner on black: the title's backdrop, its name and episode, a progress line that
// eases forward, and a line saying what is happening, which changes if the lookup takes a while.
// A prepared (cached) stream shows this for a moment only. The parent remounts it (key) for every
// new lookup - a retry or the next episode - which restarts the progress line and the messages.
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { loadingMessage } from './streamLoadingText.ts';

interface StreamLoadingProps {
  title: string;
  /** "S1 · E3 · Episode name", or nothing for a movie. */
  subtitle?: string;
  backdrop?: string;
  onBack: () => void;
}

export const StreamLoading: React.FC<StreamLoadingProps> = ({ title, subtitle, backdrop, onBack }) => {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div role="status" aria-live="polite" style={{ position: 'fixed', inset: 0, backgroundColor: '#000', zIndex: 9999, overflow: 'hidden' }}>
      {backdrop && (
        <img
          src={backdrop}
          alt=""
          decoding="async"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }}
        />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.92) 100%)' }} />

      <button onClick={onBack} className="interactive nf-icon-btn" aria-label="Back" style={{ position: 'absolute', top: 'calc(16px + var(--safe-top))', left: '16px', zIndex: 2 }}>
        <ArrowLeft size={28} color="#fff" />
      </button>

      <div style={{ position: 'absolute', left: '24px', right: '24px', bottom: 'calc(40px + var(--safe-bottom))', zIndex: 2, color: '#fff' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.3px', textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>{title}</h2>
        {subtitle && <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.75)', marginTop: '6px' }}>{subtitle}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '18px', fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>
          <Loader2 size={16} className="animate-spin" color="var(--accent-primary)" />
          <span>{loadingMessage(now - startedAt)}</span>
        </div>
        <div style={{ position: 'relative', height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.18)', marginTop: '12px', overflow: 'hidden' }}>
          {/* Eases toward 90% over about eight seconds; the player replaces this screen when ready. */}
          <div className="stream-progress-fill" />
        </div>
      </div>
    </div>
  );
};
