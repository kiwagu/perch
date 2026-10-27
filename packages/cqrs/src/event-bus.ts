import { err, ok, okAsync, ResultAsync } from 'neverthrow'

import type { DomainEvent } from '@workspace/kernel'

import type { BusError } from './bus'

export type Subscriber<E extends DomainEvent> = (event: E) => ResultAsync<unknown, BusError>

/** What went wrong in one subscriber's run, or nothing: a throw counts as a failure. */
async function failureOf<E extends DomainEvent>(
  subscriber: Subscriber<E>,
  event: E,
): Promise<BusError | undefined> {
  try {
    const result = await subscriber(event)

    return result.isErr() ? result.error : undefined
  } catch (error: unknown) {
    return { code: 'bus:SUBSCRIBER_THREW', message: String(error) }
  }
}

/**
 * Publishes events after a change is committed and waits for every subscriber: the ones of the
 * event's name in the order they subscribed, then the ones of any event. A subscriber that
 * fails or throws is collected and the others still run.
 */
export class EventBus<E extends DomainEvent> {
  readonly #subscribers = new Map<string, Subscriber<E>[]>()
  #any: Subscriber<E>[] = []

  subscribe<Name extends E['name']>(
    name: Name,
    subscriber: Subscriber<Extract<E, { readonly name: Name }>>,
  ): () => void {
    const entry = subscriber as Subscriber<E>

    this.#subscribers.set(name, [...(this.#subscribers.get(name) ?? []), entry])

    return () => {
      this.#subscribers.set(
        name,
        (this.#subscribers.get(name) ?? []).filter((candidate) => candidate !== entry),
      )
    }
  }

  /**
   * Subscribes for the first event of `name` only; it is gone before it runs. A publish that took
   * its list before then, still under way, finds it spent and calls nothing.
   */
  once<Name extends E['name']>(
    name: Name,
    subscriber: Subscriber<Extract<E, { readonly name: Name }>>,
  ): () => void {
    let spent = false
    const unsubscribe = this.subscribe(name, (event) => {
      if (spent) {
        return okAsync(undefined)
      }

      spent = true
      unsubscribe()

      return subscriber(event)
    })

    return () => {
      spent = true
      unsubscribe()
    }
  }

  /** Subscribes to every event, told after the subscribers of its name. */
  onAny(subscriber: Subscriber<E>): () => void {
    this.#any = [...this.#any, subscriber]

    return () => {
      this.#any = this.#any.filter((candidate) => candidate !== subscriber)
    }
  }

  publish(events: readonly E[]): ResultAsync<void, BusError> {
    const run = async (): Promise<BusError[]> => {
      const failures: BusError[] = []

      for (const event of events) {
        // The list is taken before it runs: a subscriber taken once that leaves changes nothing
        // for the others of this event.
        for (const subscriber of [...(this.#subscribers.get(event.name) ?? []), ...this.#any]) {
          const failure = await failureOf(subscriber, event)

          if (failure !== undefined) {
            failures.push(failure)
          }
        }
      }

      return failures
    }

    return ResultAsync.fromSafePromise(run()).andThen((failures) =>
      failures.length === 0
        ? ok(undefined)
        : err({ code: 'bus:SUBSCRIBER_FAILED', causes: failures }),
    )
  }
}
