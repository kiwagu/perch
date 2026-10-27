import { describe, expect, it } from 'vitest'

import type { DomainEvent } from '@workspace/kernel'

import { fakeEventBus } from './fake-event-bus'

type Renamed = DomainEvent<'profile.renamed', { name: string }>

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
})
