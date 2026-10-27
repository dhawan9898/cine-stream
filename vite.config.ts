import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // The Telegram client (GramJS) is written for webpack and expects Node's
    // Buffer, crypto, util, events, os and path. Without these the app throws
    // "Buffer is not defined" / "reading 'custom'" when Settings loads.
    nodePolyfills({
      include: ['buffer', 'crypto', 'util', 'events', 'os', 'path', 'stream', 'process'],
      globals: { Buffer: true, global: true, process: true }
    })
  ],
  define: {
    // CI sets APP_VERSION to the release version (e.g. 1.0.42) so Settings shows what is installed.
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || pkg.version)
  },
  build: {
    chunkSizeWarningLimit: 900
  },
  server: {
    port: 3001,
    host: true,
    proxy: {
      '/api-tmdb': {
        target: 'https://api.themoviedb.org/3',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-tmdb/, '')
      }
    }
  }
})
