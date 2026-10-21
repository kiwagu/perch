import type { LocalDb } from '@workspace/data'

/** What a tracked query answers: like the driver's query, it can be awaited and retried. */
interface Retryable extends Promise<unknown> {
  retry(): Promise<unknown>
}

/**
 * Counts the queries in flight on the databases of a test world, so a test that drives the
 * manual clock moves it only while the code under test waits on a timer, as a real clock would:
 * a slow query never lets a wait of the same flow run out before it answers.
 */
export class QueryTracker {
  #inFlight = 0

  /** The database with each query counted from when it is made until it answers. */
  wrap(database: LocalDb): LocalDb {
    const query = (text: string, bindings?: Record<string, unknown>): Retryable => {
      let retrying = false

      this.#inFlight += 1

      // Sent once the caller had the chance to ask for retries, as the driver's own query is.
      const answer = Promise.resolve()
        .then(() =>
          retrying ? database.db.query(text, bindings).retry() : database.db.query(text, bindings),
        )
        .finally(() => {
          this.#inFlight -= 1
        })

      return Object.assign(answer, {
        retry: () => {
          retrying = true

          return answer
        },
      })
    }
    const db = new Proxy(database.db, {
      get(target, property) {
        if (property === 'query') {
          return query
        }

        const value: unknown = Reflect.get(target, property)

        // Methods of the driver use private fields, so they run on the real instance.
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value
      },
    })

    return { ...database, db }
  }

  /** Resolves once no query is in flight. */
  async idle(): Promise<void> {
    while (this.#inFlight > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
  }
}
