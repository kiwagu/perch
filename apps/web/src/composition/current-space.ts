/**
 * The application's reads and writes, bound to the space of whoever is signed in: the
 * container hands out these two ports once, and they follow the session from one identity
 * to the next. While nobody is signed in they refuse, saying so; writes also refuse while a
 * sign-out runs in any tab of the browser.
 */

import { errAsync, type ResultAsync } from 'neverthrow'

import {
  type Command,
  type CommandMeta,
  type DataError,
  dataError,
  type Shape,
  type ShapeRunnerPort,
  type WatchOptions,
  type WritePathPort,
} from '@workspace/data'

import type { IdentitySpace } from './identity-space'

/** The current space, and how to hear that it changed. */
export interface SpaceSource {
  current(): IdentitySpace | undefined
  onSwitch(listener: () => void): () => void
  /**
   * A sign-out runs in this tab or another one of the browser: a write landing after its final
   * drain would be deleted with the database, so none is taken until it ends.
   */
  signingOut(): boolean
  /**
   * Runs a write admitted into `space` while holding the identity's write lock shared, until
   * its change is durable: a sign-out deletes the database only once no write of any tab runs.
   */
  writing<T>(space: IdentitySpace, work: () => ResultAsync<T, DataError>): ResultAsync<T, DataError>
}

const signedOut = (what: string): string => `sign in first: ${what} needs the signed-in identity`

/** Reads through the current space; a watch moves to the next space when the identity changes. */
export class CurrentSpaceRunner implements ShapeRunnerPort {
  constructor(private readonly spaces: SpaceSource) {}

  read<Params, Result>(
    shape: Shape<Params, Result>,
    params: Params,
  ): ResultAsync<Result, DataError> {
    const space = this.spaces.current()

    return space
      ? space.runner.read(shape, params)
      : errAsync(dataError('data:QUERY_FAILED', signedOut(`shape ${shape.id}`)))
  }

  watch<Params, Result>(
    shape: Shape<Params, Result>,
    params: Params,
    onTree: (tree: Result) => void,
    options?: WatchOptions,
  ): () => void {
    const start = (): (() => void) => {
      const space = this.spaces.current()

      if (!space) {
        options?.onError?.(dataError('data:QUERY_FAILED', signedOut(`shape ${shape.id}`)))

        return () => {}
      }

      return space.runner.watch(shape, params, onTree, options)
    }
    let stop = start()
    const unswitch = this.spaces.onSwitch(() => {
      stop()
      stop = start()
    })

    return () => {
      unswitch()
      stop()
    }
  }
}

/**
 * Writes into the current space's region; refuses while nobody is signed in or a sign-out runs.
 * A write it admits runs under the identity's write lock until its change is durable.
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

    return this.spaces.signingOut()
      ? errAsync(dataError('data:WRITE_REJECTED', 'signing out'))
      : this.spaces.writing(space, () => space.writePath.run(command, params, meta))
  }
}
