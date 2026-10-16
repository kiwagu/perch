/**
 * Makes plain `.surql` files importable under the Bun runtime (scripts and CLIs),
 * as the Vite plugin does for bundles and vitest: the default export is the file text.
 * Registered through `preload` in the root bunfig.toml.
 */

import { readFileSync } from 'node:fs'
import { plugin } from 'bun'

plugin({
  name: 'workspace:surql',
  setup(build) {
    build.onLoad({ filter: /\.surql$/ }, ({ path }) => ({
      contents: `export default ${JSON.stringify(readFileSync(path, 'utf8'))}`,
      loader: 'js',
    }))
  },
})
