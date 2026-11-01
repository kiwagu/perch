import { expect } from 'vitest'

/** What a spec puts in an address, a subject or a link, so that a leak of it into an error shows. */
export const LEAK = 'leak-marker-7f3a'

/** What `work` rejects with; fails when it resolves. */
export function rejection(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => {
      throw new Error('expected a rejection')
    },
    (error: unknown) => error,
  )
}

/** What `work` throws; fails when it returns. */
export function thrown(work: () => unknown): unknown {
  try {
    work()
  } catch (error) {
    return error
  }

  throw new Error('expected a throw')
}

/** Fails unless `error` is an Error whose message, stack and cause carry nothing of `LEAK`. */
export function expectNoLeak(error: unknown): void {
  if (!(error instanceof Error)) {
    throw new Error('expected an Error')
  }

  expect(error.message.toLowerCase()).not.toContain(LEAK)
  expect(String(error.stack).toLowerCase()).not.toContain(LEAK)
  expect(error.cause).toBeUndefined()
}
