import type { ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { Command } from '@workspace/data'
import { token } from '@workspace/di'

/** Runs declared commands as the signed-in user: validated, logged, written to the replica. */
export interface CommandsPort {
  execute<Params>(command: Command<Params>, params: Params): ResultAsync<void, BusError>
}

export const COMMANDS = token<CommandsPort>('Commands')
