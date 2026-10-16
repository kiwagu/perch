/** Small persistent key-value storage for session tokens. */
export interface KeyValueStorage {
  get(key: string): string | undefined
  set(key: string, value: string): void
  remove(key: string): void
}

export function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()

  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value)
    },
    remove: (key) => {
      values.delete(key)
    },
  }
}

/** The browser's localStorage; when it is unavailable (private mode, blocked), nothing is kept. */
export function browserStorage(store: Storage): KeyValueStorage {
  const attempt = <T>(run: () => T, fallback: T): T => {
    try {
      return run()
    } catch {
      return fallback
    }
  }

  return {
    get: (key) => attempt(() => store.getItem(key) ?? undefined, undefined),
    set: (key, value) => attempt(() => store.setItem(key, value), undefined),
    remove: (key) => attempt(() => store.removeItem(key), undefined),
  }
}
