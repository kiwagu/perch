import { okAsync } from 'neverthrow'

import type { DomainEvent } from '@workspace/kernel'

import { EventBus } from './event-bus'

/** A bus for tests: the real one, with everything published kept to assert on. */
export interface FakeEventBus<E extends DomainEvent> {
  readonly bus: EventBus<E>
  readonly published: readonly E[]
  /** Throws unless an event of `name` was published, and one that `predicate` holds for when given. */
  assertPublished(name: E['name'], predicate?: (event: E) => boolean): void
}

export function fakeEventBus<E extends DomainEvent>(): FakeEventBus<E> {
  const bus = new EventBus<E>()
  const published: E[] = []

  bus.onAny((event) => {
    published.push(event)

    return okAsync(undefined)
  })

  return {
    bus,
    published,
    assertPublished: (name, predicate = () => true) => {
      if (!published.some((event) => event.name === name && predicate(event))) {
        throw new Error(`no ${name} was published that matches`)
      }
    },
  }
}
