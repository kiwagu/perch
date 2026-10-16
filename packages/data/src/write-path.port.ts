import type { ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'

import type { DataError } from './errors'
import type { Command } from './types'

/** Executes declared commands. The product path writes through the replica; tests may write directly. */
export interface WritePathPort {
  run<Params>(command: Command<Params>, params: Params): ResultAsync<void, DataError>
}

export const WRITE_PATH = token<WritePathPort>('WritePath')
