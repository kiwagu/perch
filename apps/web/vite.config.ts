import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { surqlPlugin } from '@workspace/data/vite-plugin-surql'

export default defineConfig({
  plugins: [surqlPlugin(), react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // The WASM engine must not be pre-bundled, and it initialises with top-level await.
  optimizeDeps: { exclude: ['@surrealdb/wasm', '@surrealdb/wasm-native'] },
  build: { target: 'esnext' },
  worker: { format: 'es' },
  server: { port: Number(process.env['E2E_WEB_PORT'] ?? 5173), strictPort: true },
})
