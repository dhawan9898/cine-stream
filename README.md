# CineStream 🎬🍿

**CineStream** is a streaming application built with **React 19**, **TypeScript**, **Vite**, and **Capacitor 8**, featuring a custom **Jetpack Media3 (ExoPlayer)** native Android player and an **hls.js** web player.

Inspired by the native architecture and fluid UI of [Anistream](../Anistream), CineStream brings the same level of visual aesthetics, WebView-optimized performance, and multi-extractor playback to **Hollywood Movies, International Cinema, and TV Series**.

---

## 🌟 Key Features

### 1. 📡 Multi-Extractor Streaming Engine & TMDB Catalog
- **Direct TMDB v3 Integration**: High-speed catalog fetching of trending titles, popular releases, critically acclaimed movies, and TV shows on the air, backed by in-flight request deduplication and exponential-backoff retries.
- **Concurrent Stream Discovery Engine**: Six title extractors run in parallel with automatic fallback to embedded playback or native stream sniffing:
  - 🔴 **Flixeo** (`flixeo.tv`)
  - 🔵 **VidLink PRO** (`vidlink.pro`)
  - 🟢 **VidSrc** (`vidsrc.to` and mirrors)
  - 🌐 **AutoEmbed** (`autoembed.co`)
  - 🟣 **MultiEmbed** (`multiembed.mov`)
  - 🇮🇳 **Movierulz Regional** (`5movierulz.site`) for Telugu, Hindi, Tamil, Malayalam and Kannada titles

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

Both apps (CineStream and [Anistream](../Anistream)) share one architecture. Everything that is
not a content provider lives in the vendored `streamkit/` package (UI shell, dock, hero carousel,
category picker, player panels, HTTP layer, tiered cache, theme store, history helpers, provider
health/hedging, base stylesheets). Only the `providers/` folder differs.

```
CineStream/
├── streamkit/                    # Shared package (sync: node scripts/sync-streamkit.mjs ../streamkit)
├── android-overrides/            # Native Android Jetpack Media3 overrides (copied in CI)
├── scripts/                      # patch-android.mjs (+test), sync-streamkit.mjs, CLI stream tests
└── src/
    ├── main.tsx, App.tsx         # Bootstrap; kept-alive tab shell, overlay stack & back bridge
    ├── index.css                 # App design tokens + app-specific rules (base rules: streamkit)
    ├── providers/                # <- the only provider-specific code
    │   ├── cineHypeCore.ts       # TMDB catalog client & data models
    │   ├── streamResolver.ts     # Cached stream resolution with fallback embed URL
    │   ├── subtitleService.ts, webSniffer.ts
    │   └── extractors/           # Six title extractors + registry (health, last-good, early exit)
    ├── services/                 # historyService, themeService, persistentCache config, nativePlayer, ...
    ├── components/               # Adapters over streamkit (HeroCarousel, GenrePicker) + app widgets
    ├── pages/                    # Home, Browse, Search, MediaDetail, Library, Settings
    └── plugins/                  # Capacitor bridge to the native player
```

---

## 🚀 Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Configure your TMDB API key (required) in .env
cp .env.example .env   # then set VITE_TMDB_API_KEY

# 3. Start development server on http://localhost:3001
npm run dev
```

> **TMDB key:** the key is no longer hardcoded. Locally it comes from `.env`; in CI it comes from the
> `TMDB_API_KEY` repository secret (the workflow fails fast if it is missing). Note that any key bundled
> into a client app can be extracted from the APK, so use a key you can rotate, or put a proxy in front of TMDB.
> The CLI scripts in `scripts/` read `TMDB_API_KEY` / `VITE_TMDB_API_KEY` from the environment.

### Quality checks

```bash
npm run lint        # oxlint
npm test            # unit tests (TMDB client, error helpers, Android patch script)
npm run typecheck   # tsc -b
```

CI runs lint and tests before building. The Android project is generated in CI and customised by
`scripts/patch-android.mjs`, which fails the build if any patch step no longer applies.

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
