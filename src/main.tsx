// main.tsx - CineStream App Entry Point
import './polyfills.ts';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-500.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-700.css';
import '@fontsource/outfit/latin-800.css';
import './index.css';

// Keep stray async failures (e.g. blocked autoplay, dropped requests) from surfacing as crashes.
window.addEventListener('unhandledrejection', (e) => {
  console.warn('Unhandled rejection:', e.reason);
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
