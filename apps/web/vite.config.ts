import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import wasm from 'vite-plugin-wasm'

import { surqlPlugin } from '@workspace/data/vite-plugin-surql'

import { stripWasmSourceMaps } from './build/wasm-source-maps'

const MANIFEST_INPUTS = ['contract', 'tests/e2e/scenarios'].map((path) =>
  fileURLToPath(new URL(`../../${path}`, import.meta.url)),
)

// `bun run build` writes the UI manifest into dist/ui-manifest with `ui-contract manifest`
// once Vite is done. The development watcher empties its outDir (dist-dev/) on its first
// build, so there the same command runs after every build, into <outDir>/ui-manifest, and a change of a contract file or of a scenario (the
// folders of the contract and of the scenario files are watched, at any depth) rebuilds.
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

const BUILD = 'virtual:perch-build'
const REPOSITORY = fileURLToPath(new URL('../..', import.meta.url))

/** What git answers in the repository, or undefined when it fails (outside git). */
function git(...args: readonly string[]): string | undefined {
  const run = spawnSync('git', args, { cwd: REPOSITORY, encoding: 'utf8' })

  return run.status === 0 ? run.stdout.trim() : undefined
}

/** A path of the repository's git directory, as git resolves it (a worktree has its own). */
function gitPath(path: string): string | undefined {
  const found = git('rev-parse', '--git-path', path)

  return found === undefined ? undefined : resolve(REPOSITORY, found)
}

/** The product the UI manifest names too: the root package's version, the commit checked out. */
function product(): { readonly version: string; readonly commit: string | null } {
  const { version } = JSON.parse(readFileSync(join(REPOSITORY, 'package.json'), 'utf8')) as {
    readonly version: string
  }
  const commit = git('rev-parse', 'HEAD') ?? ''

  return { version, commit: /^[0-9a-f]{40}$/.test(commit) ? commit : null }
}

// The build this bundle is, `import build from 'virtual:perch-build'`: the root package's version
// and the commit checked out, the same product the UI manifest names, so a tab compares the
// manifest the server serves with its own. The watcher makes it again whenever the commit or the
// version moves, as the manifest it writes after each build follows them too.
function buildIdentity(): Plugin {
  const id = `\0${BUILD}`

  return {
    name: 'perch:build-identity',
    resolveId: (source) => (source === BUILD ? id : undefined),
    load(source) {
      if (source !== id) {
        return undefined
      }

      const branch = git('symbolic-ref', '-q', 'HEAD')
      const watched = [
        gitPath('HEAD'),
        gitPath('packed-refs'),
        branch === undefined ? undefined : gitPath(branch),
        join(REPOSITORY, 'package.json'),
      ]

      for (const file of watched) {
        if (file !== undefined) {
          this.addWatchFile(file)
        }
      }

      return `export default ${JSON.stringify(product())}`
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    surqlPlugin(),
    wasm(),
    react(),
    tailwindcss(),
    uiManifestOnWatch(),
    buildIdentity(),
    stripWasmSourceMaps(),
  ],
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
  // `bun run dev` rebuilds in development mode on every change (`vite build --watch`, into
  // dist-dev/): readable output with source maps, served by the dev stand's Caddy front.
  build: {
    target: 'esnext',
    sourcemap: mode === 'development',
    minify: mode !== 'development',
  },
  // A worker's bundle runs its own plugins: its WASM loses the source-map section too.
  worker: { format: 'es', plugins: () => [stripWasmSourceMaps()] },
}))
