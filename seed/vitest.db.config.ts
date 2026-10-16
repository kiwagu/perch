import { defineConfig } from 'vitest/config'

import { surqlPlugin } from '@workspace/data/vite-plugin-surql'

export default defineConfig({
  plugins: [surqlPlugin()],
  test: { include: ['src/**/*.db.spec.ts'], testTimeout: 30000, hookTimeout: 30000 },
})
