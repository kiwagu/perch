/**
 * The session's transitions (a sign-in, a sign-out, a restore, following another tab), run one
 * at a time, each when the previous one has finished, so the saved keys and the space never
 * serve two transitions at once. Each runs under a generation of its own: a transition that
 * finishes after a later one began is dropped.
 */

import { errAsync, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

export class SessionTransitions {
  #generation = 0
  #queue: Promise<unknown> = Promise.resolve()
  #closed = false

  /** The generation of the latest transition. */
  generation(): number {
    return this.#generation
  }

  isClosed(): boolean {
    return this.#closed
  }

  /**
   * Closes without waiting: a new generation starts, so a transition still running attaches
   * nothing, and the queued ones do not run.
   */
  close(): void {
    this.#closed = true
    this.#begin()
  }

  serially<T>(run: (generation: number) => ResultAsync<T, DataError>): ResultAsync<T, DataError> {
    // A closed session runs nothing more, transitions queued before the close included.
    const result = this.#queue.then(() =>
      this.#closed
        ? errAsync(dataError('data:AUTH_FAILED', 'the session is closed'))
        : run(this.#begin()),
    )

    this.#queue = result.then(
      () => undefined,
      () => undefined,
    )

    return new ResultAsync(result)
  }

  /** Starts a session transition. */
  #begin(): number {
    this.#generation += 1

    return this.#generation
  }
}
