import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.spec.js'],
    // A spec's first lint builds the TypeScript program of its fixtures: 0.7 s alone, 4 to 7 s
    // while the other packages' tests run beside it, past vitest's default 5 s.
    testTimeout: 30_000,
  },
})
