import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import { AggregateRoot } from './aggregate-root'
import { type DomainEvent, defineEvent } from './base-event'
import { Entity } from './entity'
import { ValueObject } from './value-object'

class Note extends Entity<string, { text: string }> {
  static of(id: string, text: string): Note {
    return new Note(id, { text })
  }
}

class Money extends ValueObject<{ amount: number; currency: string }> {
  static of(amount: number, currency: string): Money {
    return new Money({ amount, currency })
  }
}

const Renamed = defineEvent('profile.renamed', z.object({ name: z.string().min(1) }))

type ProfileEvent = DomainEvent<'profile.renamed', { name: string }>

class Profile extends AggregateRoot<string, { name: string }, ProfileEvent> {
  static of(id: string, name: string): Profile {
    return new Profile(id, { name })
  }

  rename(name: string, actorId: string): void {
    this.props = { ...this.props, name }
    this.record(Renamed.create({ name }, { actorId })._unsafeUnwrap())
  }
}

describe('Entity', () => {
  it('compares by identity, not by attributes', () => {
    expect(Note.of('n1', 'a').equals(Note.of('n1', 'b'))).toBe(true)
    expect(Note.of('n1', 'a').equals(Note.of('n2', 'a'))).toBe(false)
  })
})

describe('ValueObject', () => {
  it('compares by value and exposes the value read-only', () => {
    expect(Money.of(5, 'EUR').equals(Money.of(5, 'EUR'))).toBe(true)
    expect(Money.of(5, 'EUR').equals(Money.of(6, 'EUR'))).toBe(false)
    expect(Money.of(5, 'EUR').unpack()).toEqual({ amount: 5, currency: 'EUR' })
  })
})

describe('AggregateRoot', () => {
  it('collects recorded events and hands them out once', () => {
    const profile = Profile.of('p1', 'Ann')

    profile.rename('Anna', 'idn_1')

    const events = profile.pullEvents()

    expect(events.map((event) => [event.name, event.payload, event.actorId])).toEqual([
      ['profile.renamed', { name: 'Anna' }, 'idn_1'],
    ])
    expect(profile.pullEvents()).toEqual([])
  })
})

describe('defineEvent', () => {
  it('validates the payload with its schema', () => {
    const invalid = Renamed.create({ name: '' }, { actorId: 'idn_1' })

    expect(invalid.isErr()).toBe(true)
    expect(invalid._unsafeUnwrapErr().code).toBe('kernel:INVALID_EVENT_PAYLOAD')
  })

  it('stamps the actor and the time', () => {
    const at = new Date('2026-01-01T00:00:00Z')
    const event = Renamed.create({ name: 'Ann' }, { actorId: 'idn_1', occurredAt: at })

    expect(event._unsafeUnwrap()).toEqual({
      name: 'profile.renamed',
      payload: { name: 'Ann' },
      actorId: 'idn_1',
      occurredAt: at,
    })
  })
})
