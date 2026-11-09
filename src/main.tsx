// main.tsx - CineStream App Entry Point
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import 'streamkit/styles/fonts.css';
import 'streamkit/styles/dock.css'
import 'streamkit/styles/shared.css';
import './index.css';
import { applyGlassStyle, getGlassStyle } from './services/glassService.ts';
import { refreshSavedStream } from './providers/streamResolver.ts';
import { startStreamRevalidator } from './providers/streamRevalidator.ts';

// Keep stray async failures (e.g. blocked autoplay, dropped requests) from surfacing as crashes.
window.addEventListener('unhandledrejection', (e) => {
  console.warn('Unhandled rejection:', e.reason);
  e.preventDefault();
});

// Transparent-glass setting (index.html applies it pre-paint too).
applyGlassStyle(getGlassStyle());

// Saved stream links load with the app; while it is idle they are re-checked and dead ones looked up again.
startStreamRevalidator(refreshSavedStream);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
