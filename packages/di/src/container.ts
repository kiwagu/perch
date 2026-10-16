/**
 * A dependency container without decorators or reflection. A port and its token
 * are declared together; implementations are bound by factories at the
 * composition root, and classes receive their dependencies through constructors.
 */

export type Token<T> = symbol & { readonly __type?: T }

export type Factory<T> = (container: Container) => T

export const token = <T>(name: string): Token<T> => Symbol(name) as Token<T>

export class Container {
  readonly #factories = new Map<symbol, Factory<unknown>>()
  readonly #instances = new Map<symbol, unknown>()
  readonly #parent: Container | undefined

  constructor(parent?: Container) {
    this.#parent = parent
  }

  singleton<T>(key: Token<T>, factory: Factory<T>): this {
    this.#factories.set(key, factory)
    this.#instances.delete(key)

    return this
  }

  get<T>(key: Token<T>): T {
    if (this.#instances.has(key)) {
      return this.#instances.get(key) as T
    }

    const factory = this.#factories.get(key)

    if (!factory) {
      if (!this.#parent) {
        throw new Error(`no provider bound for ${key.description ?? 'an unnamed token'}`)
      }

      return this.#parent.get(key)
    }

    const instance = factory(this) as T

    this.#instances.set(key, instance)

    return instance
  }

  child(): Container {
    return new Container(this)
  }
}
