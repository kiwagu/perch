import { describe, expect, it } from 'vitest'

import { type LockManagerLike, leadership, lockName } from './leader'

interface Waiting {
  readonly callback: () => Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
  readonly signal: AbortSignal | undefined
}

function abortError(): Error {
  const error = new Error('The lock request is aborted')

  error.name = 'AbortError'

  return error
}

/** Mirrors `navigator.locks`: requests are granted in order, `steal` rejects the old holder. */
class FakeLocks implements LockManagerLike {
  readonly queue: Waiting[] = []
  failWith: unknown
  requests = 0
  private holder: Waiting | undefined

  request(
    _name: string,
    options: { readonly steal?: boolean; readonly signal?: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void> {
    this.requests += 1
    if (this.failWith !== undefined) return Promise.reject(this.failWith)

    return new Promise<void>((resolve, reject) => {
      const waiting: Waiting = { callback, resolve, reject, signal: options.signal }

      if (options.steal) {
        this.holder?.reject(abortError())
        this.grant(waiting)
      } else if (this.holder === undefined) {
        this.grant(waiting)
      } else {
        this.queue.push(waiting)
        options.signal?.addEventListener('abort', () => {
          const at = this.queue.indexOf(waiting)

          if (at < 0) return
          this.queue.splice(at, 1)
          reject(abortError())
        })
      }
    })
  }

  private grant(waiting: Waiting): void {
    this.holder = waiting
    void waiting.callback().then(() => {
      waiting.resolve()
      if (this.holder !== waiting) return
      this.holder = undefined
      const next = this.queue.shift()

      if (next !== undefined) this.grant(next)
    })
  }
}

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
    await second?.takeOver()
    expect(second?.isLeader()).toBe(true)
    await settle()
    expect(first?.isLeader()).toBe(false)
    expect(lost).toEqual([false])
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

  it('no Web Locks: no leadership object', () => {
    expect(leadership(undefined, lockName('a'))).toBeUndefined()
  })

  it('names the lock after the identity', () => {
    expect(lockName('u1')).toBe('perch-sync:u1')
  })
})
