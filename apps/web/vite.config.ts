import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

import { surqlPlugin } from '@workspace/data/vite-plugin-surql'

export default defineConfig(({ mode }) => ({
  plugins: [surqlPlugin(), wasm(), react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // Loro's default browser build loads its WASM by synchronous XHR on the main
      // thread; the bundler build fetches it asynchronously, in dev and in builds.
      // Tests run under Node and keep Loro's Node build.
      ...(mode === 'test' ? [] : [{ find: /^loro-crdt$/, replacement: 'loro-crdt/bundler' }]),
    ],
  },
  // WASM packages are served as they are: pre-bundling breaks their initialisation
  // order, and they initialise with top-level await.
  optimizeDeps: { exclude: ['@surrealdb/wasm', '@surrealdb/wasm-native', 'loro-crdt'] },
  build: { target: 'esnext' },
  worker: { format: 'es' },
  server: { port: Number(process.env['E2E_WEB_PORT'] ?? 5180), strictPort: true },
}))
