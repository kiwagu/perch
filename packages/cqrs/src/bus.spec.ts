import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import { createBus, type Middleware } from './bus'
import type { ExecutionContext } from './context'
import { validatePayloads } from './middleware'

type Rename = { readonly type: 'profile.rename'; readonly payload: { readonly name: string } }
type Reset = { readonly type: 'profile.reset'; readonly payload: Record<string, never> }

const context: ExecutionContext = {
  actorId: 'idn_1',
  deviceId: 'dev_1',
  tenantId: null,
  correlationId: 'cor_1',
}

const handlers = {
  'profile.rename': (message: Rename) => okAsync(`renamed to ${message.payload.name}`),
  'profile.reset': () => okAsync(0),
}

describe('createBus', () => {
  it('routes a message to its handler and types the result', async () => {
    const bus = createBus<Rename | Reset, typeof handlers>(handlers)
    const result = await bus.execute({ type: 'profile.rename', payload: { name: 'Ann' } }, context)

    expect(result._unsafeUnwrap()).toBe('renamed to Ann')
  })

  it('refuses a message type it has no handler for', async () => {
    const bus = createBus<Rename | Reset, typeof handlers>(handlers)
    // @ts-expect-error: the bus only accepts its own message types
    const result = await bus.execute({ type: 'profile.unknown', payload: {} }, context)

    expect(result._unsafeUnwrapErr().code).toBe('bus:NO_HANDLER')
  })

  it('runs middleware in order around the handler', async () => {
    const seen: string[] = []
    const trace =
      (label: string): Middleware =>
      (message, _context, next) => {
        seen.push(`${label}:before`)

        return next(message).map((value) => {
          seen.push(`${label}:after`)

          return value
        })
      }
    const bus = createBus<Rename | Reset, typeof handlers>(handlers, [trace('a'), trace('b')])

    const result = await bus.execute({ type: 'profile.reset', payload: {} }, context)

    expect(result._unsafeUnwrap()).toBe(0)
    expect(seen).toEqual(['a:before', 'b:before', 'b:after', 'a:after'])
  })

  it('rejects an invalid payload before the handler runs', async () => {
    let handled = false
    const guarded = {
      ...handlers,
      'profile.rename': (message: Rename) => {
        handled = true

        return okAsync(message.payload.name)
      },
    }
    const bus = createBus<Rename | Reset, typeof guarded>(guarded, [
      validatePayloads({ 'profile.rename': z.object({ name: z.string().min(1) }) }),
    ])
    const result = await bus.execute({ type: 'profile.rename', payload: { name: '' } }, context)

    expect(result._unsafeUnwrapErr().code).toBe('bus:INVALID_PAYLOAD')
    expect(handled).toBe(false)
  })

  it('hands the parsed payload to the handler', async () => {
    const bus = createBus<Rename | Reset, typeof handlers>(handlers, [
      validatePayloads({ 'profile.rename': z.object({ name: z.string().trim() }) }),
    ])
    const result = await bus.execute(
      { type: 'profile.rename', payload: { name: '  Ann ' } },
      context,
    )

    expect(result._unsafeUnwrap()).toBe('renamed to Ann')
  })
})
