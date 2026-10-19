import { errAsync, type ResultAsync } from 'neverthrow'

import {
  type Command,
  type CommandMeta,
  type DataError,
  dataError,
  type WritePathPort,
} from '@workspace/data'

import { type SpaceSource, signedOut } from './space-source'

/**
 * Writes into the current space's region; refuses while nobody is signed in or a sign-out runs.
 * A write it admits runs under the identity's write lock until its change is durable. The lock
 * may come only after a sign-out or a refused-keys cleanup let it go: the write then goes on
 * only into the space it was admitted for, still current, and while no sign-out runs.
 */
export class CurrentSpaceWritePath implements WritePathPort {
  constructor(private readonly spaces: Pick<SpaceSource, 'current' | 'signingOut' | 'writing'>) {}

  run<Params>(
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

      return this.spaces.signingOut()
        ? errAsync(dataError('data:WRITE_REJECTED', 'signing out'))
        : space.writePath.run(command, params, meta)
    })
  }
}
