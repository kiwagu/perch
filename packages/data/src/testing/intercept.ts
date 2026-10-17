import type { LocalDb } from '../types'

/** What `query` answers: like the driver's query, it can be awaited and retried. */
interface Retryable extends PromiseLike<unknown> {
  retry(): PromiseLike<unknown>
}

/** A query the hook refused: a rejection whose retry answers with the same rejection. */
function refused(error: unknown): Promise<never> & Retryable {
  const rejected = Promise.reject(error)

  return Object.assign(rejected, { retry: () => rejected })
}

/**
 * A query held until the hook settles. Only then is the driver's query sent, once, and
 * retried on a conflict when the caller asked for that with `retry()` in the meantime.
 */
function held(
  hook: Promise<void>,
  send: (retrying: boolean) => PromiseLike<unknown>,
): Promise<unknown> & Retryable {
  let retrying = false
  const answer = hook.then(() => send(retrying))

  return Object.assign(answer, {
    retry: () => {
      retrying = true

      return answer
    },
  })
}

/**
 * The test database with a hook in front of every query: the hook may wait, to
 * hold a query in flight, or throw, to make it fail, as a slow or broken database
 * would. A query the hook lets through at once is the driver's own; every other
 * method reaches the database unchanged.
 */
export function interceptQueries(
  database: LocalDb,
  before: (text: string) => void | Promise<void>,
): LocalDb {
  const query = (text: string, bindings?: Record<string, unknown>): Retryable => {
    let hook: void | Promise<void>

    try {
      hook = before(text)
    } catch (error) {
      return refused(error)
    }

    if (hook instanceof Promise) {
      return held(hook, (retrying) =>
        retrying ? database.db.query(text, bindings).retry() : database.db.query(text, bindings),
      )
    }

    return database.db.query(text, bindings)
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
