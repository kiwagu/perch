import { defineConfig } from 'vitest/config'

import { surqlPlugin } from '@workspace/data/vite-plugin-surql'

// Specs named `*.db.spec.ts` need a running SurrealDB stand and run in `test:db`.
export default defineConfig({
  plugins: [surqlPlugin()],
  test: { exclude: ['**/node_modules/**', '**/*.db.spec.ts'] },
})
