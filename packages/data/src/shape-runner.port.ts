import type { ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'

import type { DataError } from './errors'
import type { WatchOptions } from './shape-runner'
import type { Shape } from './types'

/** Reads declared shapes and keeps them current as their tables change. */
export interface ShapeRunnerPort {
  read<Params, Result>(shape: Shape<Params, Result>, params: Params): ResultAsync<Result, DataError>
  watch<Params, Result>(
    shape: Shape<Params, Result>,
    params: Params,
    onTree: (tree: Result) => void,
    options?: WatchOptions,
  ): () => void
}

export const SHAPE_RUNNER = token<ShapeRunnerPort>('ShapeRunner')
