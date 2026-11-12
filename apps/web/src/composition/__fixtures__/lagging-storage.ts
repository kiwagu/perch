import type { MemoryStorage } from '../storage'

/** One browser's local storage whose tabs see each other's writes late: see `laggingStorage`. */
export interface LaggingStorage {
  /** The storage of one more tab of the browser, starting from what the browser holds now. */
  tab(): MemoryStorage
  /**
   * Delivers every change held back so far, oldest first: the copy of each tab that did not make
   * it takes the key as the browser holds it now, then that tab's listeners hear the key.
   */
  deliver(): void
}

interface Tab {
  readonly copy: Map<string, string>
  readonly listeners: Set<(key: string | undefined) => void>
}

/**
 * The local storage of one browser as Chromium keeps it for its tabs: each tab reads a copy of
 * its own, which takes the tab's own write at once and another tab's only once the change is
 * delivered (`deliver`), its `storage` event with it. Until then a tab reads, and decides its
 * writes by, what it saw last. The browser's store takes every write at once, in the order the
 * tabs made them, and a delivered key takes the store's value then, so the copies agree once
 * every change is delivered. A write that changes nothing in the store is told to nobody.
 * `changeElsewhere` writes as a tab the test does not open, heard at once by this tab alone.
 */
export function laggingStorage(): LaggingStorage {
  const store = new Map<string, string>()
  const tabs = new Set<Tab>()
  const held: Array<{ readonly tab: Tab; readonly key: string }> = []

  const put = (key: string, value: string | undefined): boolean => {
    const before = store.get(key)

    if (value === undefined) {
      store.delete(key)
    } else {
      store.set(key, value)
    }

    return before !== value
  }

  const keep = (copy: Map<string, string>, key: string, value: string | undefined) => {
    if (value === undefined) {
      copy.delete(key)
    } else {
      copy.set(key, value)
    }
  }

  return {
    tab: () => {
      const own: Tab = { copy: new Map(store), listeners: new Set() }
      const write = (key: string, value: string | undefined) => {
        keep(own.copy, key, value)

        if (put(key, value)) {
          for (const other of tabs) {
            if (other !== own) {
              held.push({ tab: other, key })
            }
          }
        }
      }

      tabs.add(own)

      return {
        get: (key) => own.copy.get(key),
        set: (key, value) => write(key, value),
        remove: (key) => write(key, undefined),
        onChangeElsewhere: (listener) => {
          own.listeners.add(listener)

          return () => own.listeners.delete(listener)
        },
        changeElsewhere: (key, value) => {
          put(key, value)
          keep(own.copy, key, value)

          for (const listener of [...own.listeners]) {
            listener(key)
          }
        },
      }
    },
    deliver: () => {
      for (const { tab, key } of held.splice(0)) {
        keep(tab.copy, key, store.get(key))

        for (const listener of [...tab.listeners]) {
          listener(key)
        }
      }
    },
  }
}
