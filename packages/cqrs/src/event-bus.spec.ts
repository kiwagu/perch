import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { DomainEvent } from '@workspace/kernel'

import { EventBus } from './event-bus'

type Renamed = DomainEvent<'profile.renamed', { name: string }>

const renamed: Renamed = {
  name: 'profile.renamed',
  payload: { name: 'Ann' },
  actorId: 'usr_1',
  occurredAt: new Date(0),
}

describe('EventBus', () => {
  it('awaits every subscriber of an event in subscription order', async () => {
    const seen: string[] = []
    const bus = new EventBus<Renamed>()

    bus.subscribe('profile.renamed', (event) => {
      seen.push(`first ${event.payload.name}`)

      return okAsync(undefined)
    })
    bus.subscribe('profile.renamed', (event) => {
      seen.push(`second ${event.payload.name}`)

      return okAsync(undefined)
    })

    const result = await bus.publish([renamed])

    expect(result.isOk()).toBe(true)
    expect(seen).toEqual(['first Ann', 'second Ann'])
  })

  it('reports failed subscribers without skipping the others', async () => {
    const seen: string[] = []
    const bus = new EventBus<Renamed>()

    bus.subscribe('profile.renamed', () => errAsync({ code: 'test:FAILED' }))
    bus.subscribe('profile.renamed', () => {
      seen.push('second')

      return okAsync(undefined)
    })

    const result = await bus.publish([renamed])

    expect(result._unsafeUnwrapErr()).toEqual({
      code: 'bus:SUBSCRIBER_FAILED',
      causes: [{ code: 'test:FAILED' }],
    })
    expect(seen).toEqual(['second'])
  })
})
