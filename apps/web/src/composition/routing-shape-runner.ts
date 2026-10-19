import { err, errAsync, ok, type Result, type ResultAsync } from 'neverthrow'

import {
  type DataError,
  dataError,
  type Shape,
  type ShapeRunnerPort,
  type WatchOptions,
} from '@workspace/data'
import type { ReplicaSchema } from '@workspace/replica'

import { NO_TENANT } from './no-tenant'

/** Reads a shape whose tables all live in the tenant region from the current organisation's database. */
export class RoutingShapeRunner implements ShapeRunnerPort {
  constructor(
    private readonly own: ShapeRunnerPort,
    private readonly tenant: () => ShapeRunnerPort | undefined,
    private readonly schema: ReplicaSchema,
    /** Hears another organisation become current, or none. */
    private readonly onTenantChange: (listener: () => void) => () => void,
  ) {}

  read<Params, Result>(
    shape: Shape<Params, Result>,
    params: Params,
  ): ResultAsync<Result, DataError> {
    const runner = this.#runnerOf(shape)

    return runner.isOk() ? runner.value.read(shape, params) : errAsync(runner.error)
  }

  watch<Params, Result>(
    shape: Shape<Params, Result>,
    params: Params,
    onTree: (tree: Result) => void,
    options?: WatchOptions,
  ): () => void {
    if (!this.#inTenant(shape)) {
      return this.own.watch(shape, params, onTree, options)
    }

    const start = (): (() => void) => {
      const runner = this.#runnerOf(shape)

      if (runner.isErr()) {
        options?.onError?.(runner.error)

        return () => {}
      }

      return runner.value.watch(shape, params, onTree, options)
    }
    let stop = start()
    const unlisten = this.onTenantChange(() => {
      stop()
      stop = start()
    })

    return () => {
      unlisten()
      stop()
    }
  }

  #inTenant<Params, Tree>(shape: Shape<Params, Tree>): boolean {
    return (
      shape.tables.length > 0 &&
      shape.tables.every((table) => this.schema[table]?.region === 'tenant')
    )
  }

  #runnerOf<Params, Tree>(shape: Shape<Params, Tree>): Result<ShapeRunnerPort, DataError> {
    if (!this.#inTenant(shape)) {
      return ok(this.own)
    }

    const runner = this.tenant()

    return runner ? ok(runner) : err(dataError('data:QUERY_FAILED', NO_TENANT))
  }
}
