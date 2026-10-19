import type { Clock } from '@workspace/replica'

/** An attempt refused, and when to ask again. */
interface Refusal {
  readonly allowed: false
  readonly retryAfterMs: number
}

/** Whether an attempt may go on, and when to ask again if it may not. */
export type Allowance = { readonly allowed: true } | Refusal

/** An attempt counted while it is under way: its holder may give it back. */
export type Reservation =
  | {
      readonly allowed: true
      /** Uncounts the attempt, while the window that counted it still holds its key. */
      giveBack(): void
    }
  | Refusal

export interface FixedWindowOptions {
  readonly limit: number
  readonly windowMs: number
  readonly clock: Clock
  /**
   * The most keys held at once, default 100 000; an unseen key at a full table evicts the window
   * that started first, live or not.
   */
  readonly maxKeys?: number
}

interface Counter {
  readonly start: number
  count: number
}

const defaultMaxKeys = 100_000

/**
 * Counts attempts per key in fixed windows that start at a key's first attempt. The table is
 * bounded: an unseen key at a full table evicts the window that started first, even a live one,
 * rather than being refused. Availability wins over a marginal gain: refusing unseen keys would
 * let anyone who fills a table with cheap requests lock every other key out, while an evicted
 * key only starts a fresh window.
 */
export class FixedWindow {
  /** The windows in the order they started, the first started first. */
  private readonly counters = new Map<string, Counter>()
  private readonly maxKeys: number

  constructor(private readonly options: FixedWindowOptions) {
    this.maxKeys = options.maxKeys ?? defaultMaxKeys
  }

  /** Counts one attempt of `key` when its window has room; refuses it otherwise, counting nothing. */
  take(key: string): Allowance {
    const counted = this.countIn(key)

    return 'allowed' in counted ? counted : { allowed: true }
  }

  /** Counts one attempt of `key` like `take`, for its holder to give back if it does not count. */
  reserve(key: string): Reservation {
    const counted = this.countIn(key)

    if ('allowed' in counted) {
      return counted
    }

    return {
      allowed: true,
      giveBack: () => {
        // A window that restarted, or a key forgotten or evicted since, holds nothing of it.
        if (this.live(key) === counted && counted.count > 0) {
          counted.count -= 1
        }
      },
    }
  }

  /** Forgets `key`'s window (a success that clears its failures). */
  forget(key: string): void {
    this.counters.delete(key)
  }

  /** Counts one attempt of `key`: the window that counted it, or the refusal of a full window. */
  private countIn(key: string): Counter | Refusal {
    const counter = this.live(key)

    if (!counter) {
      return this.open(key)
    }

    if (counter.count < this.options.limit) {
      counter.count += 1

      return counter
    }

    return {
      allowed: false,
      retryAfterMs: counter.start + this.options.windowMs - this.options.clock.now(),
    }
  }

  private live(key: string): Counter | undefined {
    const counter = this.counters.get(key)

    if (counter && this.options.clock.now() >= counter.start + this.options.windowMs) {
      this.counters.delete(key)

      return undefined
    }

    return counter
  }

  /**
   * Starts `key`'s window with its first attempt, at the end of the table (a key whose window
   * expired was deleted by `live` first, so it moves there); at a full table, the window that
   * started first is evicted.
   */
  private open(key: string): Counter {
    if (this.counters.size >= this.maxKeys) {
      const first = this.counters.keys().next()

      if (!first.done) {
        this.counters.delete(first.value)
      }
    }

    const counter = { start: this.options.clock.now(), count: 1 }

    this.counters.set(key, counter)

    return counter
  }
}
