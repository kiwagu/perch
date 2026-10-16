import { defineConfig } from 'vitest/config'

import { surqlPlugin } from '@workspace/data/vite-plugin-surql'

export default defineConfig({ plugins: [surqlPlugin()] })
