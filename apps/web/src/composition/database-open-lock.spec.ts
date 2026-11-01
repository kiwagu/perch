import { okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { FakeLocks } from '@workspace/replica/testing'

import { openOneAtATime } from './database-open-lock'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** An open the test finishes, and what happened to it. */
function heldOpen(log: string[], name: string) {
  let finish: () => void = () => {}
  const open = () => {
    log.push(`${name} starts`)

    return ResultAsync.fromSafePromise(
      new Promise<string>((resolve) => {
        finish = () => {
          log.push(`${name} ends`)
          resolve(name)
        }
      }),
    )
  }

  return { open, finish: () => finish() }
}

describe('openOneAtATime', () => {
  it('opens one database in one tab at a time: the second open starts once the first ended', async () => {
    const locks = new FakeLocks()
    const log: string[] = []
    const a = heldOpen(log, 'a')
    const b = heldOpen(log, 'b')
    const first = openOneAtATime(locks, 'app-identity-x', a.open)
    const second = openOneAtATime(locks, 'app-identity-x', b.open)

    await settle()
    expect(log).toEqual(['a starts'])

    a.finish()
    expect((await first)._unsafeUnwrap()).toBe('a')
    await settle()
    expect(log).toEqual(['a starts', 'a ends', 'b starts'])

    b.finish()
    expect((await second)._unsafeUnwrap()).toBe('b')
  })

  it('opens different databases at once', async () => {
    const locks = new FakeLocks()
    const log: string[] = []
    const a = heldOpen(log, 'a')
    const b = heldOpen(log, 'b')

    const first = openOneAtATime(locks, 'app-identity-x', a.open)
    const second = openOneAtATime(locks, 'app-identity-y', b.open)

    await settle()

    expect(log).toEqual(['a starts', 'b starts'])
    a.finish()
    b.finish()
    expect((await first).isOk() && (await second).isOk()).toBe(true)
  })

  it('opens at once without Web Locks, and fails an open whose lock cannot be taken', async () => {
    expect((await openOneAtATime(undefined, 'x', () => okAsync(1)))._unsafeUnwrap()).toBe(1)

    const locks = new FakeLocks()

    locks.failWith = new Error('locks are gone')

    expect((await openOneAtATime(locks, 'x', () => okAsync(1)))._unsafeUnwrapErr().code).toBe(
      'data:OPEN_FAILED',
    )
  })
})
