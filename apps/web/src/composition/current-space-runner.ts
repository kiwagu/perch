import { errAsync, type ResultAsync } from 'neverthrow'

import {
  type DataError,
  dataError,
  type Shape,
  type ShapeRunnerPort,
  type WatchOptions,
} from '@workspace/data'

import { type SpaceSource, signedOut } from './space-source'

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
