import type { ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'

import type { DataError } from './errors'
import type { Command } from './types'

/** Who issued a command and as part of which flow; recorded with the write. */
export interface CommandMeta {
  readonly actorId?: string
  readonly correlationId?: string
}

/** Executes declared commands. The product path writes through the replica; tests may write directly. */
export interface WritePathPort {
  run<Params>(
    command: Command<Params>,
    params: Params,
    meta?: CommandMeta,
  ): ResultAsync<void, DataError>
}

export const WRITE_PATH = token<WritePathPort>('WritePath')
