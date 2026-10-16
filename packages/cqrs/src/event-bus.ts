import { err, ok, ResultAsync } from 'neverthrow'

import type { DomainEvent } from '@workspace/kernel'

import type { BusError } from './bus'

export type Subscriber<E extends DomainEvent> = (event: E) => ResultAsync<unknown, BusError>

/** Publishes events after a change is committed and waits for every subscriber. */
export class EventBus<E extends DomainEvent> {
  readonly #subscribers = new Map<string, Subscriber<E>[]>()

  subscribe<Name extends E['name']>(
    name: Name,
    subscriber: Subscriber<Extract<E, { readonly name: Name }>>,
  ): () => void {
    const list = this.#subscribers.get(name) ?? []
    const entry = subscriber as Subscriber<E>

    this.#subscribers.set(name, [...list, entry])

    return () => {
      this.#subscribers.set(
        name,
        (this.#subscribers.get(name) ?? []).filter((candidate) => candidate !== entry),
      )
    }
  }

  publish(events: readonly E[]): ResultAsync<void, BusError> {
    const run = async (): Promise<BusError[]> => {
      const failures: BusError[] = []

      for (const event of events) {
        for (const subscriber of this.#subscribers.get(event.name) ?? []) {
          const result = await subscriber(event)

          if (result.isErr()) {
            failures.push(result.error)
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
