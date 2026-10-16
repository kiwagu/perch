/**
 * Test doubles for packages that depend on the data layer: an embedded in-memory
 * database with the real schema applied. Bun and Node only.
 */

import { readdirSync, readFileSync } from 'node:fs'

export { FakeShapeRunner } from './fake-runner'

import type { ResultAsync } from 'neverthrow'

import { nodeEngines } from '../engines/node'
import type { DataError } from '../errors'
import { openLocalDb } from '../local-db'
import type { LocalDb } from '../types'

const SCHEMA_DIR = new URL('../../../../database/schema/', import.meta.url)

/** The shared schema: every `database/schema/*.surql` file in name order. */
export function readSchema(): string {
  return readdirSync(SCHEMA_DIR)
    .filter((name) => name.endsWith('.surql'))
    .sort()
    .map((name) => readFileSync(new URL(name, SCHEMA_DIR), 'utf8'))
    .join('\n')
}

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
