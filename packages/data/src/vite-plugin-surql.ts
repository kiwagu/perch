/**
 * Lets bundlers and vitest import `.surql` files. A `*.shape.surql` or
 * `*.commands.surql` file becomes a re-export of the object the modeling stage
 * generated beside it, so the SurrealQL is never parsed at runtime and the
 * runner only ever receives compiled shapes and commands. Any other `.surql` file
 * becomes a module whose default export is its text, for statements executed
 * inside adapters.
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

import type { Plugin } from 'vite'

// Explicit extension: vitest loads this file through Node, which needs it.
import { surqlComponentFile, surqlExportName } from './surql-names.ts'

export function surqlModuleSource(path: string, read: (path: string) => string): string {
  const component = surqlComponentFile(basename(path))

  if (component) {
    return `export { ${surqlExportName(component.name, component.role)} as default } from './${component.name}.model.gen'`
  }

  return `export default ${JSON.stringify(read(path))}`
}

export function surqlPlugin(): Plugin {
  return {
    name: 'workspace:surql',
    enforce: 'pre',
    load(id) {
      const path = id.split('?')[0] ?? id

      return path.endsWith('.surql')
        ? surqlModuleSource(path, (file) => readFileSync(file, 'utf8'))
        : undefined
    },
  }
}
