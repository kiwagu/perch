import type { ResultAsync } from 'neverthrow'

import { runCommand } from './commands'
import type { DataError } from './errors'
import type { Command, LocalDb } from './types'
import type { WritePathPort } from './write-path.port'

/** Runs a command's SurrealQL directly: for server-only tables and test fixtures, never for replicated data. */
export class SurrealWritePath implements WritePathPort {
  constructor(private readonly local: LocalDb) {}

  run<Params>(command: Command<Params>, params: Params): ResultAsync<void, DataError> {
    return runCommand(this.local, command, params)
  }
}
