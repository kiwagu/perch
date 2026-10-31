import { errAsync, ResultAsync } from 'neverthrow'

import {
  type DataError,
  dataError,
  type Shape,
  type ShapeRunnerPort,
  type WatchOptions,
} from '@workspace/data'

import { type SpaceSource, signedOut } from './space-source'

/**
 * Reads through the current space; a watch moves to the next space when the identity changes.
 * While the saved identity's space opens at the start, a read waits for it and a watch starts
 * once it is open.
 */
export class CurrentSpaceRunner implements ShapeRunnerPort {
  constructor(private readonly spaces: SpaceSource) {}

  read<Params, Result>(
    shape: Shape<Params, Result>,
    params: Params,
  ): ResultAsync<Result, DataError> {
    const opening = this.spaces.current() ? undefined : this.spaces.opening()

    return opening
      ? ResultAsync.fromSafePromise(Promise.resolve(opening)).andThen(() =>
          this.#readNow(shape, params),
        )
      : this.#readNow(shape, params)
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
        // A space still opening starts the watch once it is open: the session switches to it.
        if (this.spaces.opening() === undefined) {
          options?.onError?.(dataError('data:QUERY_FAILED', signedOut(`shape ${shape.id}`)))
        }

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

  #readNow<Params, Result>(
    shape: Shape<Params, Result>,
    params: Params,
  ): ResultAsync<Result, DataError> {
    const space = this.spaces.current()

    return space
      ? space.runner.read(shape, params)
      : errAsync(dataError('data:QUERY_FAILED', signedOut(`shape ${shape.id}`)))
  }
}
