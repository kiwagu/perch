/**
 * Makes `.surql` files importable under the Bun runtime (scripts and CLIs), the
 * same way the Vite plugin does for bundles and vitest. Registered through
 * `preload` in the root bunfig.toml, and imported first by CLIs that may start
 * in another directory.
 */

import { readFileSync } from 'node:fs'
import { plugin } from 'bun'

import { surqlModuleSource } from './vite-plugin-surql'

plugin({
  name: 'workspace:surql',
  setup(build) {
    build.onLoad({ filter: /\.surql$/ }, ({ path }) => ({
      contents: surqlModuleSource(path, (file) => readFileSync(file, 'utf8')),
      loader: 'js',
    }))
  },
})
