/**
 * Test doubles for packages that depend on the data layer: an embedded in-memory
 * database with the real schema applied. Bun and Node only.
 */

import type { ResultAsync } from 'neverthrow'

import { nodeEngines } from '../engines/node'
import type { DataError } from '../errors'
import { openLocalDb } from '../local-db'
import { readSchema } from '../schema-files'
import type { LocalDb } from '../types'

export { readSchema } from '../schema-files'

export { FakeShapeRunner } from './fake-runner'

export interface TestDbOptions {
  readonly schema?: string
  readonly namespace?: string
  readonly database?: string
}

/** A fresh `mem://` database with the schema applied; each call is isolated. */
export function openTestDb(options: TestDbOptions = {}): ResultAsync<LocalDb, DataError> {
  return openLocalDb({
    engines: nodeEngines(),
    url: 'mem://',
    namespace: options.namespace ?? 'app',
    database: options.database ?? 'app',
    schema: options.schema ?? readSchema(),
  })
}
