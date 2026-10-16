/**
 * Lets bundlers and vitest import `.surql` files. A plain `.surql` file becomes a
 * module whose default export is its text, for infrastructure statements executed
 * inside adapters. Shapes and commands are compiled by the modeling stage instead.
 */

import { readFileSync } from 'node:fs'

import type { Plugin } from 'vite'

export function surqlPlugin(): Plugin {
  return {
    name: 'workspace:surql',
    enforce: 'pre',
    load(id) {
      const path = id.split('?')[0] ?? id

      if (!path.endsWith('.surql')) {
        return undefined
      }

      return `export default ${JSON.stringify(readFileSync(path, 'utf8'))}`
    },
  }
}
