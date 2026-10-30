/** `ui-contract schemas [--check]`. */

import { schemaDrift, writeSchemas } from '../files'

import { reported } from './problems'

export function schemas(argv: readonly string[]): number {
  const root = process.cwd()

  if (!argv.includes('--check')) {
    for (const file of writeSchemas(root)) {
      console.log(`ui-contract: wrote ${file}`)
    }

    return 0
  }

  if (reported(schemaDrift(root))) {
    return 1
  }

  console.log('ui-contract: the schemas match their sources')

  return 0
}
