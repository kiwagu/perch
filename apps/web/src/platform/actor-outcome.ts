/**
 * How a screen's machine awaits a write of the app: the write's result as the promise an invoke
 * runs, and the code its failure carried, read off the invoke's error event.
 */

import type { ResultAsync } from 'neverthrow'

/** A write that resolves with its value once done, or rejects with its failure. */
export async function settled<T, E>(result: ResultAsync<T, E>): Promise<T> {
  const outcome = await result

  return outcome.isOk() ? outcome.value : Promise.reject(outcome.error)
}

/** The code a refused write rejected with, read off the error event of its invoke; else `fallback`. */
export function failureOf(event: object, fallback: string): string {
  const error = 'error' in event ? event.error : undefined

  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : fallback
}
