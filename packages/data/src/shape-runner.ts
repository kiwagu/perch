import { ResultAsync } from 'neverthrow'

import { onChange } from './changes'
import { type DataError, dataError } from './errors'
import type { LocalDb, Shape } from './types'
import { fromDriverValue, toDriverParams } from './values'

export interface WatchOptions {
  /** Changes arriving within this window cause one rerun. Defaults to one frame. */
  readonly debounceMs?: number
  readonly onError?: (error: DataError) => void
}

/**
 * Runs shapes against the local database. A watched shape reruns whenever one
 * of the tables it reads changes; there is no incremental evaluation, a shape
 * over one user's replica takes milliseconds.
 */
export class ShapeRunner {
  constructor(private readonly local: LocalDb) {}

  read<Params, Result>(
    shape: Shape<Params, Result>,
    params: Params,
  ): ResultAsync<Result, DataError> {
    const query = this.local.db.query(
      shape.text,
      toDriverParams(params, shape.params),
    ) as PromiseLike<unknown[]>

    return ResultAsync.fromPromise(Promise.resolve(query), (cause) =>
      dataError('data:QUERY_FAILED', `shape ${shape.id} failed`, cause),
    ).map((results) => fromDriverValue(results[0]) as Result)
  }

  watch<Params, Result>(
    shape: Shape<Params, Result>,
    params: Params,
    onTree: (tree: Result) => void,
    options: WatchOptions = {},
  ): () => void {
    const debounceMs = options.debounceMs ?? 16
    let timer: ReturnType<typeof setTimeout> | undefined
    let generation = 0
    let stopped = false

    const run = (): void => {
      generation++

      const mine = generation

      void this.read(shape, params).match(
        (tree) => {
          if (!stopped && mine === generation) {
            onTree(tree)
          }
        },
        (error) => options.onError?.(error),
      )
    }

    const unsubscribe = onChange(this.local, (change) => {
      if (!change.tables.some((table) => shape.tables.includes(table))) {
        return
      }

      clearTimeout(timer)
      timer = setTimeout(run, debounceMs)
    })

    timer = setTimeout(run, 0)

    return () => {
      stopped = true
      clearTimeout(timer)
      unsubscribe()
    }
  }
}
