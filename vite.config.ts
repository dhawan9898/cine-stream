import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
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
