import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'
import { fileURLToPath, URL } from 'node:url'

const BACKEND = 'http://localhost:3000'

export default defineConfig({
  plugins: [
    vue({ template: { transformAssetUrls } }),
    vuetify({ autoImport: true }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  base: '/vue-dist/',
  build: {
    outDir: '../devices/am62dxx/app/vue-dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/speech-enhancement':              BACKEND,
      '/start-speech-enhancement':        BACKEND,
      '/stop-speech-enhancement':         BACKEND,
      '/upload-speech-enhancement-file':  BACKEND,
      '/speech-devices':                  BACKEND,
      '/speech-output-devices':           BACKEND,
      '/tvm-inference':                   BACKEND,
      '/cpu-stats':                       BACKEND,
      '/ws':     { target: 'ws://localhost:3000', ws: true },
      '/speech': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
