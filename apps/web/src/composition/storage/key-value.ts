/** Small persistent key-value storage, shared by the tabs of one browser. */
export interface KeyValueStorage {
  get(key: string): string | undefined
  set(key: string, value: string): void
  remove(key: string): void
  /**
   * Hears a key that another tab of this browser set or removed, `undefined` when it cleared
   * every key; this tab's own changes are not told.
   */
  onChangeElsewhere(listener: (key: string | undefined) => void): () => void
}

export interface MemoryStorage extends KeyValueStorage {
  /** Sets a key, or removes it with `undefined`, as another tab would: the listeners hear it. */
  changeElsewhere(key: string, value: string | undefined): void
}

export function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>()
  const listeners = new Set<(key: string | undefined) => void>()

  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value)
    },
    remove: (key) => {
      values.delete(key)
    },
    onChangeElsewhere: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    changeElsewhere: (key, value) => {
      if (value === undefined) {
        values.delete(key)
      } else {
        values.set(key, value)
      }

      for (const listener of listeners) {
        listener(key)
      }
    },
  }
}

/** The part of `window` that tells a tab about storage changes made in the others. */
export interface StorageEvents {
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void
}

/** The browser's localStorage, as `siteStorage` found it working; a write it then refuses is lost. */
export function browserStorage(store: Storage, events: StorageEvents): KeyValueStorage {
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
    onChangeElsewhere: (listener) => {
      const handler = (event: StorageEvent) => {
        if (event.storageArea === store) {
          listener(event.key ?? undefined)
        }
      }

      events.addEventListener('storage', handler)

      return () => events.removeEventListener('storage', handler)
    },
  }
}
