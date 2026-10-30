/** How fast a load run goes: how many requests at a time, and its waits. */

const PARALLEL = 20

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Maps `items` with `work`, `PARALLEL` at a time, answering the results in order. */
export async function inParallel<T, R>(
  items: readonly T[],
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []

  for (let from = 0; from < items.length; from += PARALLEL) {
    const chunk = items.slice(from, from + PARALLEL)

    results.push(...(await Promise.all(chunk.map((item, i) => work(item, from + i)))))
  }

  return results
}
