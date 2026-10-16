import type { LocalDb } from '../types'

/**
 * The test database with a hook in front of every query: the hook may wait, to
 * hold a query in flight, or throw, to make it fail, as a slow or broken database
 * would. Every other method reaches the database unchanged.
 */
export function interceptQueries(
  database: LocalDb,
  before: (text: string) => void | Promise<void>,
): LocalDb {
  const query = async (text: string, bindings?: Record<string, unknown>): Promise<unknown> => {
    await before(text)

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
