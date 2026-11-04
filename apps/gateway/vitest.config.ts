import { defineConfig } from 'vitest/config'

import { surqlPlugin } from '@workspace/data/vite-plugin-surql'

export default defineConfig({
  plugins: [surqlPlugin()],
  test: {
    // The specs hash real passwords and run embedded databases: the heaviest take 3 s on a quarter
    // of a core, past vitest's default 5 s while the other packages' tests run beside them.
    testTimeout: 30_000,
  },
})
