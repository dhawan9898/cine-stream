# CineStream 🎬🍿

**CineStream** is a streaming application built with **React 19**, **TypeScript**, and **Vite**, powered by **cinehype.sc** as the media provider.

Inspired by the native architecture and fluid UI of [Anistream](../Anistream), CineStream brings the same level of visual aesthetics, responsive performance, and multi-server playback to the world of **Hollywood Movies, International Cinema, and Binge-Worthy TV Series**.

---

## 🌟 Key Features

### 1. 📡 Powered by CineHype (`cinehype.sc`)
- **Direct TMDB v3 Integration**: High-speed catalog fetching of trending titles, popular releases, critically acclaimed movies, and TV shows on the air.
- **Multi-Source Streaming Engine**: Six mirror providers configured for instant playback:
  - 🔴 **VidFast**: CineHype primary server with fast buffering and auto-play
  - 🔵 **VidSrc SU**: 1080p mirror with alternate audio tracks
  - 🟢 **VidSrc / Rypr**: Multilingual subtitle tracks
  - 🟣 **ScreenFetch**: High-speed scrubbing mirror
  - 🟠 **VaPlayer**: Backup mirror for trending releases
  - 🌐 **AutoEmbed**: Worldwide CDN mirror

### 2. 🎨 Cinema-Grade Aesthetics & Design
- **CineHype Crimson Theme**: Tailored signature dark palette with rich micro-animations, glassmorphism panels, and vibrant red/gold accents.
- **Multiple Color Themes**:
  - Cinema Crimson (Default CineHype dark mode)
  - Obsidian OLED (Pure black `#000000` for OLED displays)
  - Midnight Slate (Subtle slate navy with cyan accents)
  - Daylight (Frosted glass light mode)
- **Fluid Layout**: Fully responsive from mobile devices to 4K ultra-wide screens.

### 3. 📺 Full TV Series & Movie Experience
- **Interactive Season & Episode Navigator**: Browse all seasons and episodes with thumbnails, titles, runtimes, and plot synopses.
- **Embedded Player with In-Player Controls**:
  - Switch between all 6 streaming servers with one click inside the player
  - In-player Episode Drawer to switch episodes seamlessly without exiting playback
  - Next Episode action button
  - Refresh / Reload stream frame button
  - Fullscreen toggle
- **Official YouTube Trailers**: Watch trailers directly in a cinematic popup modal.
- **Cast & Characters**: Full cast list with actor headshots and roles.
- **Recommendations Rail**: "More Like This" contextual recommendations for every title.

### 4. 💾 Local Persistence & Library
- **Continue Watching Rail**: Saves last watched season, episode, title, and progress percentage.
- **My Watchlist (Bookmarks)**: Save titles to your personal list for later.
- **User Preferences**: Save default preferred server and theme across app launches.
- **Instant Local Storage Caching**: Minimizes unnecessary network calls for fast load times.

---

## 🏗️ Project Architecture

```
CineStream/
├── index.html                    # Application entry HTML
├── vite.config.ts                # Vite build & proxy config
├── capacitor.config.ts           # Mobile Capacitor config for Android/iOS
├── build-apk.ps1                 # Automated APK build script
├── src/
│   ├── main.tsx                  # App bootstrap
│   ├── App.tsx                   # Top-level state machine & screen navigation
│   ├── index.css                 # CineHype design tokens & utility styles
│   ├── core/
│   │   ├── cineHypeCore.ts       # TMDB API client & data models
│   │   └── persistentCache.ts    # TTL-based localStorage cache
│   ├── services/
│   │   ├── streamResolver.ts     # Multi-server CineHype stream resolver
│   │   ├── historyService.ts     # Continue watching & bookmarks service
│   │   └── themeService.ts       # Theme manager
│   ├── components/
│   │   ├── Navbar.tsx            # Floating top bar
│   │   ├── BottomNav.tsx         # Mobile navigation dock
│   │   ├── HeroCarousel.tsx      # Trending blockbusters banner
│   │   ├── MediaCard.tsx         # Poster card with ratings & badges
│   │   ├── MediaRail.tsx         # Horizontal scrolling rail
│   │   ├── FadeImage.tsx         # Skeleton shimmer & smooth image loader
│   │   ├── TrailerModal.tsx      # Embedded YouTube trailer modal
│   │   ├── VideoPlayer.tsx       # CineHype multi-server streaming player
│   │   └── ErrorBoundary.tsx     # Graceful error handler
│   └── pages/
│       ├── HomeScreen.tsx        # Hero banner, continue watching & rails
│       ├── ExploreScreen.tsx     # Filter by type, genre & sorting
│       ├── SearchScreen.tsx      # Debounced live multi-search
│       ├── MediaDetailScreen.tsx # Full metadata, cast, seasons & episodes
│       ├── LibraryScreen.tsx     # Watch history & watchlist manager
│       └── SettingsScreen.tsx    # Server preferences, theme & cache reset
```

---

## 🚀 Running Locally

```bash
# 1. Navigate to CineStream directory
cd d:/workspace/CineStream

# 2. Start development server
npm run dev

# 3. Open in browser: http://localhost:3001
```

## 📱 Building Android APK

```powershell
# Run the automated build script
.\build-apk.ps1
```
Or open in Android Studio:
```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```
