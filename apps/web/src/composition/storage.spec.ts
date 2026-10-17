import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import {
  browserStorage,
  deviceIdFrom,
  forgetDevice,
  memoryStorage,
  saveDevice,
  savedIdentity,
  savedKeys,
  saveKeys,
} from './storage'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  tokens: { access: 'access-1', refresh: 'refresh-1' },
}

describe('deviceIdFrom', () => {
  it('names the device once and keeps the name', () => {
    const storage = memoryStorage()
    const first = deviceIdFrom(storage)

    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(deviceIdFrom(storage)).toBe(first)
    expect(deviceIdFrom(memoryStorage())).not.toBe(first)
  })
})

describe('the signed-in device', () => {
  it('keeps the identity and its keys, renews the keys and forgets all of them', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)

    expect(savedIdentity(storage)).toEqual(ann.identity)
    expect(savedKeys(storage)).toEqual(ann.tokens)

    saveKeys(storage, { access: 'access-2', refresh: 'refresh-2' })

    expect(savedKeys(storage)).toEqual({ access: 'access-2', refresh: 'refresh-2' })

    forgetDevice(storage)

    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedKeys(storage)).toBeUndefined()
    expect(storage.get('perch.session.token')).toBeUndefined()
  })

  it('reads no identity from a value that does not describe one', () => {
    const storage = memoryStorage()

    for (const value of ['not json', '{"id":"prf_x","email":"a@example.test"}', '[]']) {
      storage.set('perch.session.identity', value)

      expect(savedIdentity(storage)).toBeUndefined()
    }
  })
})

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

    window.dispatch({ key: 'perch.session.identity', storageArea: area })
    window.dispatch({ key: null, storageArea: area })
    window.dispatch({ key: 'perch.session.identity', storageArea: null })
    stop()
    window.dispatch({ key: 'perch.session.token', storageArea: area })

    expect(heard).toEqual(['perch.session.identity', undefined])
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
