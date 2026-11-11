import type { ResultAsync } from 'neverthrow'

import { type DataError, type LocalDb, openLocalDb } from '@workspace/data'
import { remoteEngines } from '@workspace/data/engines/remote'
import { readSchema } from '@workspace/data/schema-files'

import type { OperatorRequest } from './operator-options'

/**
 * Connects to the directory a request names as its system user, as the seed's sweep opens its
 * stand: credentials with no namespace sign in a root user of the stand, which is not the
 * gateway's own namespace user. The directory schema is applied as the gateway applies it, which
 * leaves a database that already has it alone.
 */
export function openDirectory(request: OperatorRequest): ResultAsync<LocalDb, DataError> {
  return openLocalDb({
    engines: remoteEngines(),
    url: request.url,
    namespace: request.namespace,
    database: request.database,
    credentials: request.credentials,
    schema: readSchema('directory'),
  })
}
