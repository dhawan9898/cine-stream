# CineStream 🎬🍿

**CineStream** is a streaming application built with **React 19**, **TypeScript**, **Vite**, and **Capacitor 8**, featuring a custom **Jetpack Media3 (ExoPlayer)** native Android player and an **hls.js** web player.

Inspired by the native architecture and fluid UI of [Anistream](../Anistream), CineStream brings the same level of visual aesthetics, WebView-optimized performance, and multi-extractor playback to **Hollywood Movies, International Cinema, and TV Series**.

---

## 🌟 Key Features

### 1. 📡 Multi-Extractor Streaming Engine & TMDB Catalog
- **Direct TMDB v3 Integration**: High-speed catalog fetching of trending titles, popular releases, critically acclaimed movies, and TV shows on the air, backed by in-flight request deduplication and exponential-backoff retries.
- **Concurrent Stream Discovery Engine**: Seven title extractors run in parallel with automatic fallback to embedded playback or native stream sniffing:
  - 🔴 **Flixeo** (`flixeo.tv`)
  - 🔵 **VidLink PRO** (`vidlink.pro`)
  - 🟢 **VidSrc TO** (`vidsrc.to`)
  - 🌐 **AutoEmbed** (`autoembed.co`)
  - 🟣 **MultiEmbed** (`multiembed.mov`)
  - 🟠 **Embed.su** (`embed.su`)
  - ⚡ **SmashyStream** (`player.smashy.stream`)

### 2. 🎨 Cinema-Grade Aesthetics & WebView Performance
- **Compositor-First Rendering**: Only `transform` and `opacity` are animated; scrolling surfaces use flat opaque cards while `backdrop-filter` is reserved for small fixed chrome (floating dock, popovers, modals).
- **Multiple Color Themes**:
  - **Dark** (Default Netflix/CineStream dark mode)
  - **OLED** (Pure black `#000000` for OLED displays)
  - **Slate** (Deep slate navy with cyan accents)
  - **Light** (Frosted glass light mode)
- **Android TV & D-Pad Navigation**: Spatial keyboard/D-Pad focus management scoped to the active screen or modal layer.

### 3. 📺 Full TV Series & Movie Playback
- **Dual Native & Web Players**:
  - **Android Native Player (`ExoPlayerActivity.java`)**: Built on Jetpack Media3 (`1.5.1`) with live keyframe scrubbing, WebVTT sprite sheet thumbnail previews (`ThumbnailSprites.java`), adaptive rendition selection, subtitle auto-recovery, and WebView stream sniffing.
  - **Browser Web Player (`WebPlayer.tsx`)**: Built on `hls.js` with Screen Wake Lock, automatic MSE/audio-codec recovery, double-tap seek, right-half vertical volume swipe, playback speed control, screen lock, and Netflix-style post-play countdown.
- **Interactive Season & Episode Navigator**: Browse all seasons and episodes with thumbnails, runtimes, and plot synopses, or switch episodes directly inside the player.
- **Official YouTube Trailers**: Watch trailers in a popup modal (`TrailerModal.tsx`).

### 4. 💾 Local Persistence & Hybrid Caching
- **Continue Watching & Exact Resume**: Persists last watched season, episode, percentage, and playback timestamp (`positionMs`) to resume where you left off.
- **My List (Bookmarks)**: Save titles to your personal watchlist.
- **Hybrid `localStorage` + `IndexedDB` Cache**: TTL-based caching (`persistentCache.ts`) with automatic `IndexedDB` fallback when `localStorage` is full or evicted.

---

## 🏗️ Project Architecture

```
CineStream/
├── index.html                    # Application entry HTML & theme bootstrap
├── vite.config.ts                # Vite build & optional TMDB dev proxy config
├── capacitor.config.ts           # Capacitor config for Android
├── build-apk.ps1                 # Local automated APK build script
├── android-overrides/            # Native Android Jetpack Media3 overrides
│   ├── java/
│   │   ├── MainActivity.java     # Ad-hijack blocker & hardware back bridge
│   │   ├── ExoPlayerPlugin.java  # Capacitor plugin bridge to ExoPlayerActivity
│   │   ├── ExoPlayerActivity.java# Fullscreen Netflix-style Media3 player
│   │   └── ThumbnailSprites.java # WebVTT sprite sheet parser & frame cropper
│   └── res/                      # Native player layouts, drawables & animations
├── src/
│   ├── main.tsx                  # App bootstrap
│   ├── App.tsx                   # Kept-alive tab shell, overlay stack & back bridge
│   ├── index.css                 # Design tokens, themes & compositor animations
│   ├── core/
│   │   ├── cineHypeCore.ts       # TMDB API client & data models
│   │   └── persistentCache.ts    # Hybrid localStorage + IndexedDB TTL cache
│   ├── extractors/
│   │   ├── baseExtractor.ts      # HTTP helper & multi-hop page crawler
│   │   ├── streamDiscovery.ts    # HLS/DASH/MP4 & subtitle regex/JSON/Base64 scanner
│   │   ├── extractorRegistry.ts  # Concurrent multi-extractor coordinator
│   │   └── *Extractor.ts         # Individual provider extractors
│   ├── plugins/
│   │   └── exoPlayerPlugin.ts    # TypeScript Capacitor interface for ExoPlayerPlugin
│   ├── services/
│   │   ├── streamResolver.ts     # Cached stream resolution with fallback embed URL
│   │   ├── nativePlayer.ts       # Native vs. Web player dispatcher
│   │   ├── historyService.ts     # Watch history, resume timestamps & bookmarks
│   │   ├── browseSources.ts      # Genre & rail source definitions
│   │   ├── backStack.ts          # LIFO back-gesture claim stack for modals
│   │   ├── themeService.ts       # Theme persistence manager
│   │   └── tvNavigationService.ts# Scoped D-Pad spatial focus engine
│   ├── components/
│   │   ├── HeroCarousel.tsx      # Scroll-snap featured banner with auto-advance
│   │   ├── PosterCard.tsx        # Poster tile with hover/focus detail prefetching
│   │   ├── FadeImage.tsx         # Async-decoded smooth fade-in image component
│   │   ├── GenrePicker.tsx       # Fullscreen Categories portal modal
│   │   ├── TrailerModal.tsx      # Embedded YouTube trailer modal
│   │   ├── ConfirmModal.tsx      # Glass confirmation dialog
│   │   ├── VideoPlayer.tsx       # Stream resolution & Native/Web player orchestrator
│   │   ├── WebPlayer.tsx         # Netflix-style hls.js browser video player
│   │   ├── ErrorState.tsx        # Retryable error state banner
│   │   └── ErrorBoundary.tsx     # Top-level React error boundary
│   └── pages/
│       ├── HomeScreen.tsx        # Hero banner, Continue Watching & lazy-loaded rails
│       ├── BrowseScreen.tsx      # Infinite-scroll genre & category grid
│       ├── SearchScreen.tsx      # Debounced live multi-search & Top Searches
│       ├── MediaDetailScreen.tsx # Title metadata, seasons/episodes, cast & similar
│       ├── LibraryScreen.tsx     # Watch history & My List manager
│       └── SettingsScreen.tsx    # Theme selector, autoplay toggle & cache/history reset
└── scripts/
    ├── test-resolver.ts          # Single-title stream resolution CLI test
    └── test-all-titles.ts        # Multi-title stream resolution verification script
```

---

## 🚀 Running Locally

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Configure custom TMDB API key in .env
cp .env.example .env

# 3. Start development server on http://localhost:3001
npm run dev
```

## 📱 Building Android APK

```powershell
# Run the automated build script on Windows
.\build-apk.ps1
```
Or build manually with Capacitor and Android Studio:
```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```
