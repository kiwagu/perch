import { defineConfig } from 'vitest/config'

import { surqlPlugin } from './src/vite-plugin-surql.ts'

export default defineConfig({ plugins: [surqlPlugin()] })
