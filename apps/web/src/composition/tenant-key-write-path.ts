import { errAsync, ResultAsync } from 'neverthrow'

import {
  type Command,
  type CommandMeta,
  type DataError,
  dataError,
  type WritePathPort,
} from '@workspace/data'

import { type SpaceSource, signedOut } from './space-source'

/**
 * Writes into the tenant region of the organisation `key`, whichever organisation is current: as
 * the current-space write path does (refused while nobody is signed in or a sign-out runs, waiting
 * while the saved identity's space opens, run under the identity's write lock until durable), and
 * refused once that organisation's database is not open, or `admitted` no longer holds, when the
 * write is admitted under the lock.
 */
export class TenantKeyWritePath implements WritePathPort {
  constructor(
    private readonly spaces: Pick<SpaceSource, 'current' | 'opening' | 'signingOut' | 'writing'>,
    private readonly key: string,
    private readonly admitted: () => boolean = () => true,
  ) {}

  run<Params>(
    command: Command<Params>,
    params: Params,
    meta?: CommandMeta,
  ): ResultAsync<void, DataError> {
    const opening = this.spaces.current() ? undefined : this.spaces.opening()

    return opening
      ? ResultAsync.fromSafePromise(Promise.resolve(opening)).andThen(() =>
          this.#runNow(command, params, meta),
        )
      : this.#runNow(command, params, meta)
  }

  #runNow<Params>(
    command: Command<Params>,
    params: Params,
    meta?: CommandMeta,
  ): ResultAsync<void, DataError> {
    const space = this.spaces.current()

    if (!space) {
      return errAsync(dataError('data:WRITE_REJECTED', signedOut(`command ${command.id}`)))
    }

    if (this.spaces.signingOut()) {
      return errAsync(dataError('data:WRITE_REJECTED', 'signing out'))
    }

    return this.spaces.writing(space, () => {
      // A space closed meanwhile no longer persists what is written into it.
      if (this.spaces.current() !== space) {
        return errAsync(dataError('data:WRITE_REJECTED', 'signed out'))
      }

      if (this.spaces.signingOut()) {
        return errAsync(dataError('data:WRITE_REJECTED', 'signing out'))
      }

      const tenant = space.tenant(this.key)

      if (tenant === undefined) {
        return errAsync(
          dataError(
            'data:WRITE_REJECTED',
            `the database of the organisation ${this.key} is not open`,
          ),
        )
      }

      return this.admitted()
        ? tenant.writePath.run(command, params, meta)
        : errAsync(
            dataError('data:WRITE_REJECTED', `the write to ${this.key} is no longer admitted`),
          )
    })
  }
}
