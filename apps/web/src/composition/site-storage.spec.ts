import { describe, expect, it } from 'vitest'

import { siteStorage } from './site-storage'

interface MapStorageOptions {
  /** Forgets every write, as a browser that keeps nothing. */
  readonly drops?: boolean
  /** Throws on every write, as a browser whose quota is none. */
  readonly throws?: boolean
  /** Runs after each write: another tab acting on the same storage meanwhile. */
  readonly afterSet?: () => void
}

/** A working localStorage over a map, unless its options say otherwise. */
class MapStorage implements Storage {
  readonly #values = new Map<string, string>()
  readonly #options: MapStorageOptions

  constructor(options: MapStorageOptions = {}) {
    this.#options = options
  }

  get length(): number {
    return this.#values.size
  }

  clear(): void {
    this.#values.clear()
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  setItem(key: string, value: string): void {
    if (this.#options.throws) {
      throw new DOMException('the quota is 0', 'QuotaExceededError')
    }

    if (!this.#options.drops) {
      this.#values.set(key, value)
    }

    this.#options.afterSet?.()
  }
}

describe('siteStorage', () => {
  it("answers the page's localStorage when it keeps a value, and leaves nothing behind", () => {
    const store = new MapStorage()
    const result = siteStorage({ localStorage: store, sessionStorage: new MapStorage() })

    expect(result._unsafeUnwrap()).toBe(store)
    expect(store.length).toBe(0)
  })

  it('refuses a localStorage the browser will not hand out', () => {
    const blocked = {
      get localStorage(): Storage {
        throw new DOMException('access is denied for this document', 'SecurityError')
      },
      sessionStorage: new MapStorage(),
    }

    expect(siteStorage(blocked)._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
  })

  it("takes a storage another tab probes at the same moment: neither probe removes the other's value", () => {
    const others: boolean[] = []
    // Another tab probes the same storage between this probe's write and its read.
    const store: Storage = new MapStorage({
      afterSet: () => {
        if (others.length === 0) {
          others.push(true)
          others.push(siteStorage({ localStorage: store, sessionStorage: new MapStorage() }).isOk())
        }
      },
    })

    expect(siteStorage({ localStorage: store, sessionStorage: new MapStorage() }).isOk()).toBe(true)
    expect(others).toEqual([true, true])
  })

  it('refuses a page without localStorage', () => {
    expect(siteStorage({ localStorage: null, sessionStorage: new MapStorage() }).isErr()).toBe(true)
  })

  it('refuses a localStorage that throws on every write', () => {
    expect(
      siteStorage({
        localStorage: new MapStorage({ throws: true }),
        sessionStorage: new MapStorage(),
      }).isErr(),
    ).toBe(true)
  })

  it('refuses a localStorage that drops what it is given', () => {
    expect(
      siteStorage({
        localStorage: new MapStorage({ drops: true }),
        sessionStorage: new MapStorage(),
      }).isErr(),
    ).toBe(true)
  })

  it("refuses a page whose tab keeps nothing in its sessionStorage, which the frame's reloads by itself need", () => {
    const local = new MapStorage()

    expect(siteStorage({ localStorage: local, sessionStorage: null }).isErr()).toBe(true)
    expect(
      siteStorage({
        localStorage: local,
        sessionStorage: new MapStorage({ throws: true }),
      }).isErr(),
    ).toBe(true)
    expect(
      siteStorage({ localStorage: local, sessionStorage: new MapStorage({ drops: true }) }).isErr(),
    ).toBe(true)
    expect(local.length).toBe(0)
  })
})
