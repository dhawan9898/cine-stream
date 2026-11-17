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
import { initSpeculation } from './providers/speculation.ts';
import { loadProviderConfig } from './providers/providerConfig.ts';
import { startCloudSync } from './services/cloudAccount.ts';
import { startErrorCapture } from './services/errorCapture.ts';

// Failures are sent to the app_errors table (see services/errorCapture.ts). First, so it sees
// everything that goes wrong while the rest starts.
startErrorCapture();

// Keep stray async failures (e.g. blocked autoplay, dropped requests) from surfacing as crashes.
window.addEventListener('unhandledrejection', (e) => {
  console.warn('Unhandled rejection:', e.reason);
  e.preventDefault();
});

// Transparent-glass setting (index.html applies it pre-paint too).
applyGlassStyle(getGlassStyle());

// Saved stream links load with the app; while it is idle they are re-checked and dead ones looked up again.
startStreamRevalidator(refreshSavedStream);
initSpeculation();
// Provider kill switch / host overrides: the saved copy applies at once, a fresh one downloads in the background.
void loadProviderConfig();
// Signed in: bring history, My List and settings in line with the other devices.
startCloudSync();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
