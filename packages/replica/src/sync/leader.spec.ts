import { describe, expect, it } from 'vitest'

import { FakeLocks } from '../testing'

import { leadership, lockName, writeLockName } from './leader'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('leadership', () => {
  it('the first tab leads, the second waits', async () => {
    const locks = new FakeLocks()
    const first = leadership(locks, lockName('a'))
    const second = leadership(locks, lockName('a'))

    await settle()
    expect(first?.isLeader()).toBe(true)
    expect(second?.isLeader()).toBe(false)
  })

  it('the second leads once the first stops', async () => {
    const locks = new FakeLocks()
    const first = leadership(locks, lockName('a'))
    const second = leadership(locks, lockName('a'))
    const changes: boolean[] = []

    second?.onChange((leader) => changes.push(leader))
    await settle()
    first?.stop()
    await settle()
    expect(first?.isLeader()).toBe(false)
    expect(second?.isLeader()).toBe(true)
    expect(changes).toEqual([true])
  })

  it('takeOver steals the lock and the old leader learns it lost', async () => {
    const locks = new FakeLocks()
    const first = leadership(locks, lockName('a'))
    const second = leadership(locks, lockName('a'))
    const lost: boolean[] = []

    first?.onChange((leader) => lost.push(leader))
    await settle()
    const taking = second?.takeOver()

    expect(second?.isLeader()).toBe(false)
    await taking
    expect(second?.isLeader()).toBe(true)
    await settle()
    expect(first?.isLeader()).toBe(false)
    expect(lost).toEqual([true, false])
    expect(locks.queue.length).toBe(1)
    second?.stop()
    await settle()
    expect(first?.isLeader()).toBe(true)
  })

  it('stop while waiting cancels the request', async () => {
    const locks = new FakeLocks()

    leadership(locks, lockName('a'))
    const second = leadership(locks, lockName('a'))

    await settle()
    expect(locks.queue.length).toBe(1)
    second?.stop()
    await settle()
    expect(locks.queue.length).toBe(0)
    expect(second?.isLeader()).toBe(false)
  })

  it('an unknown rejection reports false once and does not retry', async () => {
    const locks = new FakeLocks()

    locks.failWith = new Error('SecurityError')
    const tab = leadership(locks, lockName('a'))
    const changes: boolean[] = []

    tab?.onChange((leader) => changes.push(leader))
    await settle()
    expect(changes).toEqual([false])
    expect(locks.requests).toBe(1)
    expect(tab?.isLeader()).toBe(false)
  })

  it('takeOver twice in a row resolves both and the tab leads once', async () => {
    const locks = new FakeLocks()

    leadership(locks, lockName('a'))
    const second = leadership(locks, lockName('a'))
    const changes: boolean[] = []

    second?.onChange((leader) => changes.push(leader))
    await settle()
    await Promise.all([second?.takeOver(), second?.takeOver()])
    await settle()
    expect(second?.isLeader()).toBe(true)
    expect(changes).toEqual([true])
  })

  it('stop during a pending takeOver resolves it without leading', async () => {
    const locks = new FakeLocks()

    leadership(locks, lockName('a'))
    const second = leadership(locks, lockName('a'))

    await settle()
    const taking = second?.takeOver()

    second?.stop()
    await taking
    await settle()
    expect(second?.isLeader()).toBe(false)
  })

  it('takeOver is a no-op when already leading or stopped', async () => {
    const locks = new FakeLocks()
    const tab = leadership(locks, lockName('a'))

    await settle()
    const requests = locks.requests

    await tab?.takeOver()
    expect(locks.requests).toBe(requests)
    tab?.stop()
    await tab?.takeOver()
    expect(locks.requests).toBe(requests)
    expect(tab?.isLeader()).toBe(false)
  })

  it('stop twice reports false once', async () => {
    const locks = new FakeLocks()
    const tab = leadership(locks, lockName('a'))
    const changes: boolean[] = []

    tab?.onChange((leader) => changes.push(leader))
    await settle()
    tab?.stop()
    tab?.stop()
    await settle()
    expect(changes).toEqual([true, false])
  })

  it('an unsubscribed listener is not notified', async () => {
    const locks = new FakeLocks()
    const tab = leadership(locks, lockName('a'))
    const changes: boolean[] = []
    const off = tab?.onChange((leader) => changes.push(leader))

    off?.()
    await settle()
    expect(tab?.isLeader()).toBe(true)
    expect(changes).toEqual([])
  })

  it('no Web Locks: no leadership object', () => {
    expect(leadership(undefined, lockName('a'))).toBeUndefined()
  })

  it('names the lock after the identity', () => {
    expect(lockName('u1')).toBe('perch-sync:u1')
    expect(writeLockName('u1')).toBe('perch-write:u1')
  })
})

/** A lock request whose holder keeps the lock until the test lets it go. */
function held(
  locks: FakeLocks,
  name: string,
  mode: 'shared' | 'exclusive',
  log: string[],
  who: string,
) {
  let release = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const granted = locks.request(name, { mode }, async () => {
    log.push(`${who} granted`)
    await released
  })

  return { release, granted }
}

describe('the fake Web Locks', () => {
  it('grants any number of shared requests of a name at once', async () => {
    const locks = new FakeLocks()
    const log: string[] = []
    const one = held(locks, 'w', 'shared', log, 'one')
    const two = held(locks, 'w', 'shared', log, 'two')

    await settle()
    expect(log).toEqual(['one granted', 'two granted'])
    one.release()
    two.release()
    await Promise.all([one.granted, two.granted])
  })

  it('grants an exclusive request once every holder let go, and holds new ones back meanwhile', async () => {
    const locks = new FakeLocks()
    const log: string[] = []
    const one = held(locks, 'w', 'shared', log, 'one')
    const two = held(locks, 'w', 'shared', log, 'two')
    const sole = held(locks, 'w', 'exclusive', log, 'sole')
    const late = held(locks, 'w', 'shared', log, 'late')

    await settle()
    expect(log).toEqual(['one granted', 'two granted'])
    expect(locks.waiting('w', 'exclusive')).toBe(true)
    expect(locks.waiting('w', 'shared')).toBe(true)
    expect(locks.waiting('other')).toBe(false)

    one.release()
    await settle()
    expect(log).toEqual(['one granted', 'two granted'])

    two.release()
    await settle()
    // The shared request made after the exclusive one waits behind it.
    expect(log).toEqual(['one granted', 'two granted', 'sole granted'])

    sole.release()
    await settle()
    expect(log).toEqual(['one granted', 'two granted', 'sole granted', 'late granted'])
    late.release()
    await Promise.all([one.granted, two.granted, sole.granted, late.granted])
  })

  it('lets the requests behind a waiting exclusive one through once it gives up', async () => {
    const locks = new FakeLocks()
    const log: string[] = []
    const one = held(locks, 'w', 'shared', log, 'one')
    const controller = new AbortController()
    const sole = locks.request('w', { mode: 'exclusive', signal: controller.signal }, async () => {
      log.push('sole granted')
    })
    const late = held(locks, 'w', 'shared', log, 'late')

    await settle()
    expect(log).toEqual(['one granted'])

    controller.abort()

    await expect(sole).rejects.toMatchObject({ name: 'AbortError' })
    await settle()
    expect(log).toEqual(['one granted', 'late granted'])
    one.release()
    late.release()
  })

  it('keeps the locks of different names apart', async () => {
    const locks = new FakeLocks()
    const log: string[] = []
    const write = held(locks, 'w', 'exclusive', log, 'write')
    const sync = held(locks, 's', 'exclusive', log, 'sync')

    await settle()
    expect(log).toEqual(['write granted', 'sync granted'])
    write.release()
    sync.release()
  })
})
