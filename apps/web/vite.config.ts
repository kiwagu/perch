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
      // thread; the bundler build fetches it asynchronously, in every build.
      // Tests run under Node and keep Loro's Node build.
      ...(mode === 'test' ? [] : [{ find: /^loro-crdt$/, replacement: 'loro-crdt/bundler' }]),
    ],
  },
  // `bun run dev` rebuilds in development mode on every change (`vite build --watch`):
  // readable output with source maps, served by the stands' Caddy front.
  build: {
    target: 'esnext',
    sourcemap: mode === 'development',
    minify: mode !== 'development',
  },
  worker: { format: 'es' },
}))
