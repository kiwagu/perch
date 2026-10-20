import { describe, expect, it } from 'vitest'

import { siteStorage } from './site-storage'

/** A working localStorage over a map; `drops` forgets every write, as a browser that keeps nothing. */
class MapStorage implements Storage {
  readonly #values = new Map<string, string>()
  readonly #drops: boolean
  readonly #throws: boolean

  constructor(options: { readonly drops?: boolean; readonly throws?: boolean } = {}) {
    this.#drops = options.drops ?? false
    this.#throws = options.throws ?? false
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
    if (this.#throws) {
      throw new DOMException('the quota is 0', 'QuotaExceededError')
    }

    if (!this.#drops) {
      this.#values.set(key, value)
    }
  }
}

describe('siteStorage', () => {
  it("answers the page's localStorage when it keeps a value, and leaves nothing behind", () => {
    const store = new MapStorage()
    const result = siteStorage({ localStorage: store })

    expect(result._unsafeUnwrap()).toBe(store)
    expect(store.length).toBe(0)
  })

  it('refuses a localStorage the browser will not hand out', () => {
    const blocked = {
      get localStorage(): Storage {
        throw new DOMException('access is denied for this document', 'SecurityError')
      },
    }

    expect(siteStorage(blocked)._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
  })

  it('refuses a page without localStorage', () => {
    expect(siteStorage({ localStorage: null }).isErr()).toBe(true)
  })

  it('refuses a localStorage that throws on every write', () => {
    expect(siteStorage({ localStorage: new MapStorage({ throws: true }) }).isErr()).toBe(true)
  })

  it('refuses a localStorage that drops what it is given', () => {
    expect(siteStorage({ localStorage: new MapStorage({ drops: true }) }).isErr()).toBe(true)
  })
})
