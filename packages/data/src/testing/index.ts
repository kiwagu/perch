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
export { interceptQueries } from './intercept'

/**
 * A fixed signing key for tests that apply a schema again and expect issued tokens to stay
 * valid, as a server's gateway does with its own key. Test-only: no server signs with it.
 */
export const TEST_SIGNING_KEY =
  'test-only-signing-key-not-for-any-server-0123456789abcdefghijklmnopqrstuvwxyz'

export interface TestDbOptions {
  readonly schema?: string
  readonly namespace?: string
  readonly database?: string
  /** The key the access methods sign with; without one each apply gets a key of its own. */
  readonly signingKey?: string
}

/** A fresh `mem://` database with the directory schema applied; each call is isolated. */
export function openTestDb(options: TestDbOptions = {}): ResultAsync<LocalDb, DataError> {
  return openLocalDb({
    engines: nodeEngines(),
    url: 'mem://',
    namespace: options.namespace ?? 'app',
    database: options.database ?? 'app',
    schema: options.schema ?? readSchema('directory'),
    ...(options.signingKey === undefined ? {} : { signingKey: options.signingKey }),
  })
}
