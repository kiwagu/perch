import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { DomainEvent } from '@workspace/kernel'

import { EventBus } from './event-bus'

type Renamed = DomainEvent<'profile.renamed', { name: string }>

const renamed: Renamed = {
  name: 'profile.renamed',
  payload: { name: 'Ann' },
  actorId: 'idn_1',
  occurredAt: new Date(0),
}

type Left = DomainEvent<'profile.left', { reason: string }>

const left: Left = {
  name: 'profile.left',
  payload: { reason: 'moved' },
  actorId: 'idn_1',
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

  it('calls a subscriber taken once only for the first event, gone before it runs', async () => {
    const seen: string[] = []
    const bus = new EventBus<Renamed>()

    bus.once('profile.renamed', (event) => {
      seen.push(event.payload.name)

      return okAsync(undefined)
    })

    expect((await bus.publish([renamed, { ...renamed, payload: { name: 'Bea' } }])).isOk()).toBe(
      true,
    )
    expect((await bus.publish([renamed])).isOk()).toBe(true)
    expect(seen).toEqual(['Ann'])
  })

  it('lets a subscriber taken once be dropped before any event', async () => {
    const seen: string[] = []
    const bus = new EventBus<Renamed>()
    const drop = bus.once('profile.renamed', () => {
      seen.push('called')

      return okAsync(undefined)
    })

    drop()

    expect((await bus.publish([renamed])).isOk()).toBe(true)
    expect(seen).toEqual([])
  })

  it('tells a subscriber of any event every event, after the named subscribers', async () => {
    const seen: string[] = []
    const bus = new EventBus<Renamed | Left>()

    bus.onAny((event) => {
      seen.push(`any ${event.name}`)

      return okAsync(undefined)
    })
    bus.subscribe('profile.renamed', () => {
      seen.push('named profile.renamed')

      return okAsync(undefined)
    })

    expect((await bus.publish([renamed, left])).isOk()).toBe(true)
    expect(seen).toEqual(['named profile.renamed', 'any profile.renamed', 'any profile.left'])
  })

  it('collects a subscriber that throws, and still runs the others', async () => {
    const seen: string[] = []
    const bus = new EventBus<Renamed>()

    bus.subscribe('profile.renamed', () => {
      throw new Error('broken')
    })
    bus.onAny(() => {
      seen.push('any')

      return okAsync(undefined)
    })

    const result = await bus.publish([renamed])

    expect(result._unsafeUnwrapErr()).toEqual({
      code: 'bus:SUBSCRIBER_FAILED',
      causes: [{ code: 'bus:SUBSCRIBER_THREW', message: 'Error: broken' }],
    })
    expect(seen).toEqual(['any'])
  })
})
