import { describe, expect, it } from 'vitest'

import { manualClock } from '@workspace/replica/testing'

import { PendingPairs } from './pending-pairs'

describe('PendingPairs key operations', () => {
  it('runs the key operations of one device one at a time, in order, and those of other devices at once', async () => {
    const pairs = new PendingPairs(manualClock())
    const log: string[] = []
    let finishFirst = () => {}
    const first = pairs.exclusively('laptop', async () => {
      log.push('first starts')
      await new Promise<void>((resolve) => {
        finishFirst = resolve
      })
      log.push('first ends')

      return 1
    })
    const second = pairs.exclusively('laptop', async () => {
      log.push('second runs')

      return 2
    })
    const phone = pairs.exclusively('phone', async () => {
      log.push('phone runs')

      return 3
    })

    expect(await phone).toBe(3)
    expect(log).toEqual(['first starts', 'phone runs'])

    finishFirst()

    expect(await first).toBe(1)
    expect(await second).toBe(2)
    expect(log).toEqual(['first starts', 'phone runs', 'first ends', 'second runs'])
  })

  it('runs the next operation of the device once one before it failed', async () => {
    const pairs = new PendingPairs(manualClock())
    const failed = pairs.exclusively('laptop', () =>
      Promise.reject(new Error('the database failed')),
    )

    await expect(failed).rejects.toThrow('the database failed')
    expect(await pairs.exclusively('laptop', async () => 'next')).toBe('next')
  })
})

describe('PendingPairs parking', () => {
  const pair = { access: 'access-b', refresh: 'refresh-b' }
  const identity = 'idn_0000000000000000.01m52pexcp' as Parameters<PendingPairs['unpark']>[0]

  it('hands a parked pair out once, to its device and the key it presents, within 60 seconds', async () => {
    const clock = manualClock()
    const pairs = new PendingPairs(clock)

    pairs.park({ identity, device: 'laptop', spentRefresh: 'key-a', tokens: pair })

    expect(pairs.parked({ device: 'phone', refresh: 'key-a' })).toBeUndefined()
    expect(pairs.parked({ device: 'laptop', refresh: 'key-a' })).toEqual({ identity, tokens: pair })
    expect(pairs.parked({ device: 'laptop', refresh: 'key-a' })).toBeUndefined()

    pairs.park({ identity, device: 'laptop', spentRefresh: 'key-a', tokens: pair })
    await clock.advance(60_000)

    expect(pairs.parked({ device: 'laptop', refresh: 'key-a' })).toBeUndefined()
  })
})
