import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import wasm from 'vite-plugin-wasm'

import { surqlPlugin } from '@workspace/data/vite-plugin-surql'

const MANIFEST_INPUTS = [
  ...['vocabulary.md', 'screens.json', 'model.schema.json'].map((file) => `contract/${file}`),
  'tests/e2e/scenarios',
].map((path) => fileURLToPath(new URL(`../../${path}`, import.meta.url)))

// `bun run build` writes the UI manifest into dist/ui-manifest with `ui-contract manifest`
// once Vite is done. The development watcher empties dist/ on its first build, so there the
// same command runs after every build, and a change of a contract file or of a scenario (the
// folder of the scenario files is watched) rebuilds.
function uiManifestOnWatch(): Plugin {
  let root = ''
  let outDir = ''

  return {
    name: 'perch:ui-manifest-on-watch',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = resolve(config.root, config.build.outDir)
    },
    buildStart() {
      if (this.meta.watchMode) {
        for (const file of MANIFEST_INPUTS) {
          this.addWatchFile(file)
        }
      }
    },
    writeBundle() {
      if (!this.meta.watchMode) {
        return
      }

      const out = join(outDir, 'ui-manifest')
      const run = spawnSync('ui-contract', ['manifest', '--out', out], {
        cwd: root,
        encoding: 'utf8',
      })

      if (run.status !== 0) {
        this.error(`ui-contract manifest failed: ${run.error?.message ?? run.stderr}`)
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [surqlPlugin(), wasm(), react(), tailwindcss(), uiManifestOnWatch()],
  // The page helper `window.__perch.ui` (src/platform/ui-contract.ts): in development builds,
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
  // `bun run dev` rebuilds in development mode on every change (`vite build --watch`):
  // readable output with source maps, served by the stands' Caddy front.
  build: {
    target: 'esnext',
    sourcemap: mode === 'development',
    minify: mode !== 'development',
  },
  worker: { format: 'es' },
}))
