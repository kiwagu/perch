import { ResultAsync } from 'neverthrow'

import { publishChange } from './changes'
import { type DataError, dataError } from './errors'
import type { Command, LocalDb } from './types'
import { toDriverParams } from './values'

/**
 * Executes a command's SurrealQL directly against the local database and
 * announces the change. Used for server-only tables and for seeding test
 * fixtures; replicated tables are written through the replica's write path.
 */
export function runCommand<Params>(
  local: LocalDb,
  command: Command<Params>,
  params: Params,
): ResultAsync<void, DataError> {
  const query = local.db.query(
    command.text,
    toDriverParams(params, command.params),
  ) as PromiseLike<unknown>

  return ResultAsync.fromPromise(Promise.resolve(query), (cause) =>
    dataError('data:COMMAND_FAILED', `command ${command.id} failed`, cause),
  ).map(() => publishChange(local, command.tables, 'command'))
}
