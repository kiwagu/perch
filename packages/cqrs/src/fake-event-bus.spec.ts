import { describe, expect, it } from 'vitest'

import type { DomainEvent } from '@workspace/kernel'

import { fakeEventBus } from './fake-event-bus'

type Renamed = DomainEvent<'profile.renamed', { name: string }>
type Left = DomainEvent<'profile.left', { reason: string }>

const renamed = (name: string): Renamed => ({
  name: 'profile.renamed',
  payload: { name },
  actorId: 'idn_1',
  occurredAt: new Date(0),
})

describe('fakeEventBus', () => {
  it('keeps what was published, and asserts an event by its name and a predicate', async () => {
    const fake = fakeEventBus<Renamed>()

    expect((await fake.bus.publish([renamed('Ann')])).isOk()).toBe(true)
    expect(fake.published).toEqual([renamed('Ann')])
    expect(() => fake.assertPublished('profile.renamed')).not.toThrow()
    expect(() =>
      fake.assertPublished('profile.renamed', (event) => event.payload.name === 'Bea'),
    ).toThrow('no profile.renamed was published that matches')
  })

  it("hands the predicate the event of the name asserted, with that event's payload", async () => {
    const fake = fakeEventBus<Renamed | Left>()

    expect((await fake.bus.publish([renamed('Ann')])).isOk()).toBe(true)
    expect(() =>
      fake.assertPublished('profile.renamed', (event) => event.payload.name === 'Ann'),
    ).not.toThrow()
  })
})
