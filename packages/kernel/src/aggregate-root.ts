import type { DomainEvent } from './base-event'
import { Entity } from './entity'

/** An entity that guards a consistency boundary and records what happened to it. */
export abstract class AggregateRoot<
  Id extends string,
  Props,
  Event extends DomainEvent,
> extends Entity<Id, Props> {
  readonly #events: Event[] = []

  protected record(event: Event): void {
    this.#events.push(event)
  }

  /** Returns the recorded events and forgets them, so each is published once. */
  pullEvents(): readonly Event[] {
    return this.#events.splice(0)
  }
}
