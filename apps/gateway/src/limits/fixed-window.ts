import type { Clock } from '@workspace/replica'

/** Whether an attempt may go on, and when to ask again if it may not. */
export type Allowance =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMs: number }

export interface FixedWindowOptions {
  readonly limit: number
  readonly windowMs: number
  readonly clock: Clock
  /** The most keys held at once; a full table of live keys refuses unseen keys. Default 100 000. */
  readonly maxKeys?: number
}

interface Counter {
  readonly start: number
  count: number
}

const defaultMaxKeys = 100_000

/** Counts attempts per key in fixed windows that start at a key's first attempt. */
export class FixedWindow {
  private readonly counters = new Map<string, Counter>()
  private readonly maxKeys: number

  constructor(private readonly options: FixedWindowOptions) {
    this.maxKeys = options.maxKeys ?? defaultMaxKeys
  }

  /** Counts one attempt of `key` when its window has room; refuses it otherwise, counting nothing. */
  take(key: string): Allowance {
    const counter = this.room(key)

    if (!('allowed' in counter)) {
      counter.count += 1

      return { allowed: true }
    }

    if (counter.allowed) {
      this.counters.set(key, { start: this.options.clock.now(), count: 1 })
    }

    return counter
  }

  /** Whether `key` has room in its window, counting nothing. */
  check(key: string): Allowance {
    const counter = this.room(key)

    return 'allowed' in counter ? counter : { allowed: true }
  }

  /** Counts one attempt of `key` after the fact (a failed sign-in). */
  count(key: string): void {
    const counter = this.live(key)

    if (counter) {
      counter.count += 1

      return
    }

    if (this.admitsUnseen().allowed) {
      this.counters.set(key, { start: this.options.clock.now(), count: 1 })
    }
  }

  /** Forgets `key`'s window (a success that clears its failures). */
  forget(key: string): void {
    this.counters.delete(key)
  }

  private live(key: string): Counter | undefined {
    const counter = this.counters.get(key)

    if (counter && this.options.clock.now() >= counter.start + this.options.windowMs) {
      this.counters.delete(key)

      return undefined
    }

    return counter
  }

  /** The key's live counter when it has room; otherwise the answer for an unseen key or a full window. */
  private room(key: string): Counter | Allowance {
    const counter = this.live(key)

    if (!counter) {
      return this.admitsUnseen()
    }

    if (counter.count < this.options.limit) {
      return counter
    }

    return {
      allowed: false,
      retryAfterMs: counter.start + this.options.windowMs - this.options.clock.now(),
    }
  }

  private admitsUnseen(): Allowance {
    if (this.counters.size >= this.maxKeys) {
      this.sweep()
    }

    return this.counters.size >= this.maxKeys
      ? { allowed: false, retryAfterMs: this.options.windowMs }
      : { allowed: true }
  }

  private sweep(): void {
    const now = this.options.clock.now()

    for (const [key, counter] of this.counters) {
      if (now >= counter.start + this.options.windowMs) {
        this.counters.delete(key)
      }
    }
  }
}
