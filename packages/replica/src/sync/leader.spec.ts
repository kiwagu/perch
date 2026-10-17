import { describe, expect, it } from 'vitest'

import { FakeLocks } from '../testing/fake-locks'

import { leadership, lockName } from './leader'

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
  })
})
