/**
 * Reads and writes routed by region: a shape over the tenant region's tables reads the current
 * organisation's database, and a command into the tenant region writes that organisation's
 * document; every other shape and command goes to the identity's own database and private
 * region. While no organisation is current, the tenant region's reads and writes refuse,
 * saying so. A watch over the tenant region follows the current organisation: when another one
 * becomes current it stops on the one it watched and starts on the new one, or reports that none
 * is current.
 */

import { err, errAsync, ok, type Result, type ResultAsync } from 'neverthrow'

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
import type { ReplicaSchema } from '@workspace/replica'

const NO_TENANT = 'no organisation is selected'

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
