import { okAsync } from 'neverthrow'

import type { DomainEvent } from '@workspace/kernel'

import { EventBus } from './event-bus'

/** A bus for tests: the real one, with everything published kept to assert on. */
export interface FakeEventBus<E extends DomainEvent> {
  readonly bus: EventBus<E>
  readonly published: readonly E[]
  /** Throws unless an event of `name` was published, and one that `predicate` holds for when given. */
  assertPublished<Name extends E['name']>(
    name: Name,
    predicate?: (event: Extract<E, { readonly name: Name }>) => boolean,
  ): void
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
    assertPublished: <Name extends E['name']>(
      name: Name,
      predicate: (event: Extract<E, { readonly name: Name }>) => boolean = () => true,
    ) => {
      const named = (event: E): event is Extract<E, { readonly name: Name }> => event.name === name

      if (!published.some((event) => named(event) && predicate(event))) {
        throw new Error(`no ${name} was published that matches`)
      }
    },
  }
}
