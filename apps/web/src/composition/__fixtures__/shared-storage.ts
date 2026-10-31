import type { MemoryStorage } from '../storage'

/** One browser's local storage, as each of its tabs sees it. */
export interface SharedStorage {
  /** The storage of one more tab of the browser. */
  tab(): MemoryStorage
}

/**
 * The local storage of one browser shared by its tabs, as the browser's `storage` event tells it:
 * a key a tab sets to a new value or removes is heard by every other tab in a task of its own,
 * after the writing tab's code ran, and never by the tab that wrote it; a write that changes
 * nothing (the same value, or the removal of a missing key) is heard by nobody.
 * `changeElsewhere` writes as a tab the test does not open.
 */
export function sharedStorage(): SharedStorage {
  const values = new Map<string, string>()
  const tabs = new Set<Set<(key: string | undefined) => void>>()

  return {
    tab: () => {
      const listeners = new Set<(key: string | undefined) => void>()
      const tellOthers = (key: string) => {
        for (const other of tabs) {
          if (other !== listeners) {
            setTimeout(() => {
              for (const listener of [...other]) {
                listener(key)
              }
            }, 0)
          }
        }
      }

      tabs.add(listeners)

      return {
        get: (key) => values.get(key),
        set: (key, value) => {
          const before = values.get(key)

          values.set(key, value)

          if (before !== value) {
            tellOthers(key)
          }
        },
        remove: (key) => {
          if (values.delete(key)) {
            tellOthers(key)
          }
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

          for (const listener of [...listeners]) {
            listener(key)
          }
        },
      }
    },
  }
}
