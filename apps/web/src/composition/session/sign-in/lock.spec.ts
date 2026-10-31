import { okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { DataError } from '@workspace/data'
import type { LockManagerLike } from '@workspace/replica/sync'
import { FakeLocks } from '@workspace/replica/testing'

import { oneSignInAtATime, SIGN_IN_LOCK } from './lock'

/** An attempt that throws, its text carrying a token as a broken call might. */
const throwing = (): ResultAsync<string, DataError> => {
  throw new Error('the call broke with token-1')
}

/** An attempt whose promise rejects, its text carrying a token. */
const rejecting = (): ResultAsync<string, DataError> =>
  new ResultAsync(Promise.reject(new Error('the call broke with token-1')))

describe('oneSignInAtATime', () => {
  it.each([
    ['without Web Locks', undefined],
    ['with Web Locks', new FakeLocks()],
  ] as const)(
    '%s, reads a throw or a rejection of the attempt as a failed sign-in that names no token',
    async (_, locks) => {
      for (const attempt of [throwing, rejecting]) {
        const failed = (await oneSignInAtATime(locks, attempt))._unsafeUnwrapErr()

        expect(failed).toEqual({
          code: 'data:AUTH_FAILED',
          message: 'the sign-in could not be completed',
        })
        expect(JSON.stringify(failed)).not.toContain('token-1')
      }
    },
  )

  it('lets the lock go however the attempt ended: the next attempt runs', async () => {
    const locks = new FakeLocks()

    expect((await oneSignInAtATime(locks, throwing)).isErr()).toBe(true)
    expect((await oneSignInAtATime(locks, rejecting)).isErr()).toBe(true)
    expect((await oneSignInAtATime(locks, () => okAsync('next')))._unsafeUnwrap()).toBe('next')
  })

  it('answers only once the lock was let go, so nothing after it runs under the lock', async () => {
    const fake = new FakeLocks()
    const events: string[] = []
    const locks: LockManagerLike = {
      request: (name, options, callback) =>
        fake.request(name, options, callback).finally(() => events.push(`let go of ${name}`)),
    }

    const answered = await oneSignInAtATime(locks, () => okAsync('signed in'))

    events.push(answered._unsafeUnwrap())

    expect(events).toEqual([`let go of ${SIGN_IN_LOCK}`, 'signed in'])
  })
})
