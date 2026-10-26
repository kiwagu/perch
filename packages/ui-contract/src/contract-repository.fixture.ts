/**
 * The package's fixture repository: a whole contract that passes the contract check, with its
 * scenarios, the schemas the tooling writes and a root package. The specs of the check and of
 * the manifest copy it and change what they test, so a feature's change to the real contract
 * never breaks the engine's specs.
 */

import { cpSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { writeSchemas } from './files'

const REPOSITORY = join(import.meta.dirname, '__fixtures__/repository')

/** Writes the fixture repository into the empty folder `root`. */
export function writeContractRepository(root: string): void {
  cpSync(REPOSITORY, root, { recursive: true })
  writeSchemas(root)
  writeFileSync(join(root, 'package.json'), '{ "name": "sample", "version": "0.1.0" }\n')
}
