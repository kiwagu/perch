import { describe, expect, it } from 'vitest'

import { browserStorage, memoryStorage } from './key-value'

/** A `window` that hands `storage` events to the listeners the storage adds. */
function fakeWindow() {
  const listeners = new Set<(event: StorageEvent) => void>()

  return {
    events: {
      addEventListener: (_type: 'storage', listener: (event: StorageEvent) => void) => {
        listeners.add(listener)
      },
      removeEventListener: (_type: 'storage', listener: (event: StorageEvent) => void) => {
        listeners.delete(listener)
      },
    },
    dispatch: (event: Pick<StorageEvent, 'key' | 'storageArea'>) => {
      for (const listener of listeners) {
        listener(event as StorageEvent)
      }
    },
  }
}

describe('changes made in other tabs', () => {
  it('hears the keys other tabs change in this storage, all of them when it is cleared', () => {
    const store = new Map<string, string>()
    const area = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    } as unknown as Storage
    const window = fakeWindow()
    const storage = browserStorage(area, window.events)
    const heard: Array<string | undefined> = []
    const stop = storage.onChangeElsewhere((key) => heard.push(key))

    window.dispatch({ key: 'theirs', storageArea: area })
    window.dispatch({ key: null, storageArea: area })
    window.dispatch({ key: 'theirs', storageArea: null })
    stop()
    window.dispatch({ key: 'later', storageArea: area })

    expect(heard).toEqual(['theirs', undefined])
  })

  it('lets a test change the memory storage as another tab would', () => {
    const storage = memoryStorage()
    const heard: Array<string | undefined> = []

    storage.onChangeElsewhere((key) => heard.push(key))
    storage.set('own', 'a')
    storage.changeElsewhere('theirs', 'b')
    storage.changeElsewhere('own', undefined)

    expect(heard).toEqual(['theirs', 'own'])
    expect(storage.get('theirs')).toBe('b')
    expect(storage.get('own')).toBeUndefined()
  })
})
