import { errAsync, type ResultAsync } from 'neverthrow'

import {
  type Command,
  type CommandMeta,
  type DataError,
  dataError,
  type WritePathPort,
} from '@workspace/data'

import { NO_TENANT } from './no-tenant'

/** Runs a command into the tenant region on the current organisation's document. */
export class RoutingWritePath implements WritePathPort {
  constructor(
    private readonly own: WritePathPort,
    private readonly tenant: () => WritePathPort | undefined,
  ) {}

  run<Params>(
    command: Command<Params>,
    params: Params,
    meta?: CommandMeta,
  ): ResultAsync<void, DataError> {
    if (command.region !== 'tenant') {
      return this.own.run(command, params, meta)
    }

    const path = this.tenant()

    return path
      ? path.run(command, params, meta)
      : errAsync(dataError('data:WRITE_REJECTED', NO_TENANT))
  }
}
