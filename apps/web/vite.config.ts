import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import wasm from 'vite-plugin-wasm'

import { surqlPlugin } from '@workspace/data/vite-plugin-surql'

const MANIFEST_INPUTS = ['contract', 'tests/e2e/scenarios'].map((path) =>
  fileURLToPath(new URL(`../../${path}`, import.meta.url)),
)

const MANIFEST_PATH = '/ui-manifest/'

/** What `ui-contract manifest --out` writes. */
const MANIFEST_FILES = new Set(['manifest.json', 'manifest.schema.json', 'model.schema.json'])

// `bun run build` writes the UI manifest into dist/ui-manifest with `ui-contract manifest`
// once Vite is done. The dev server writes it into its cache folder when it starts and after
// every change of a contract file or of a scenario, and serves it under /ui-manifest/; a
// change that fails the contract check keeps the last manifest and logs why.
function uiManifestInDev(): Plugin {
  return {
    name: 'perch:ui-manifest-in-dev',
    apply: 'serve',
    configureServer(server) {
      const out = resolve(server.config.cacheDir, 'ui-manifest')
      // One run at a time: a change during a run asks for one more run after it.
      let running = false
      let again = false
      const write = (): void => {
        if (running) {
          again = true

          return
        }

        running = true

        const run = spawn('ui-contract', ['manifest', '--out', out], {
          cwd: server.config.root,
          stdio: ['ignore', 'ignore', 'pipe'],
        })
        let errors = ''

        run.stderr.on('data', (chunk: Buffer) => {
          errors += chunk.toString()
        })
        run.on('close', (code) => {
          if (code !== 0) {
            server.config.logger.error(`ui-contract manifest failed: ${errors.trim()}`)
          }

          running = false

          if (again) {
            again = false
            write()
          }
        })
      }

      write()
      server.watcher.add(MANIFEST_INPUTS)
      server.watcher.on('all', (_event, file) => {
        if (MANIFEST_INPUTS.some((input) => file.startsWith(input))) {
          write()
        }
      })
      // Only the files the manifest command writes; anything else under the path, or a file
      // not written yet, is a 404, never the app's index.html.
      server.middlewares.use(MANIFEST_PATH, (request, response) => {
        const name = (request.url ?? '').split('?')[0]?.replace(/^\//, '') ?? ''
        const file = join(out, name)

        response.setHeader('Cache-Control', 'no-store')

        if (!MANIFEST_FILES.has(name) || !existsSync(file) || !statSync(file).isFile()) {
          response.statusCode = 404
          response.end()

          return
        }

        response.setHeader('Content-Type', 'application/json')
        response.end(readFileSync(file))
      })
    },
  }
}

const frontPort = process.env['FRONT_PORT']

export default defineConfig(({ mode }) => ({
  plugins: [surqlPlugin(), wasm(), react(), tailwindcss(), uiManifestInDev()],
  // The page helper `window.__perch.ui` (src/platform/ui-contract.ts): in the dev server,
  // and in a production build made with PERCH_UI_HOOKS=1 (the e2e launcher's).
  define: {
    __PERCH_UI_HOOKS__: JSON.stringify(
      mode === 'development' || process.env['PERCH_UI_HOOKS'] === '1',
    ),
  },
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // Loro's default browser build loads its WASM by synchronous XHR on the main
      // thread; the bundler build fetches it asynchronously, in every build.
      // Tests run under Node and keep Loro's Node build.
      ...(mode === 'test' ? [] : [{ find: /^loro-crdt$/, replacement: 'loro-crdt/bundler' }]),
    ],
  },
  // WASM packages are served as they are: pre-bundling breaks their initialisation order,
  // and they initialise with top-level await.
  optimizeDeps: { exclude: ['@surrealdb/wasm', '@surrealdb/wasm-native', 'loro-crdt'] },
  build: { target: 'esnext' },
  worker: { format: 'es' },
  // `bun run dev`: the dev server, opened through the stand's Caddy front
  // (https://localhost:<FRONT_PORT>), which hands the HMR socket to it as well. Vite restarts
  // it when this file changes.
  server: {
    host: '127.0.0.1',
    port: Number(process.env['WEB_DEV_PORT'] ?? 5180),
    strictPort: true,
    ...(frontPort === undefined
      ? {}
      : { hmr: { protocol: 'wss', host: 'localhost', clientPort: Number(frontPort) } }),
  },
}))
