import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '../errors'
import type { ShapeRunnerPort } from '../shape-runner.port'
import type { Shape } from '../types'

/** A shape runner without a database: trees are set by the test and pushed to watchers at once. */
export class FakeShapeRunner implements ShapeRunnerPort {
  readonly #trees = new Map<string, unknown>()
  readonly #watchers = new Map<string, Set<(tree: unknown) => void>>()
  readonly #params = new Map<string, unknown>()

  set<Params, Result>(shape: Shape<Params, Result>, tree: Result): this {
    this.#trees.set(shape.id, tree)

    for (const watcher of this.#watchers.get(shape.id) ?? []) {
      watcher(tree)
    }

    return this
  }

  read<Params, Result>(
    shape: Shape<Params, Result>,
    params: Params,
  ): ResultAsync<Result, DataError> {
    this.#params.set(shape.id, params)

    return this.#trees.has(shape.id)
      ? okAsync(this.#trees.get(shape.id) as Result)
      : errAsync(dataError('data:QUERY_FAILED', `no tree set for ${shape.id}`))
  }

  watch<Params, Result>(
    shape: Shape<Params, Result>,
    params: Params,
    onTree: (tree: Result) => void,
  ): () => void {
    const watchers = this.#watchers.get(shape.id) ?? new Set()
    const watcher = onTree as (tree: unknown) => void

    this.#params.set(shape.id, params)
    watchers.add(watcher)
    this.#watchers.set(shape.id, watchers)

    if (this.#trees.has(shape.id)) {
      watcher(this.#trees.get(shape.id))
    }

    return () => watchers.delete(watcher)
  }

  watching(shape: Shape<unknown, unknown>): number {
    return this.#watchers.get(shape.id)?.size ?? 0
  }

  lastParams(shape: Shape<unknown, unknown>): unknown {
    return this.#params.get(shape.id)
  }
}
