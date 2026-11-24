import { signJWT } from 'better-auth/crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { idSchemas } from '@workspace/ids'

import {
  AUTH_SECRET,
  accountServicesOf,
  deviceHeaders,
  openAuth,
  signUpOn,
} from '../__fixtures__/auth-instance'

import { AccountDeletions, DELETION_LINK_LIFETIME_MS } from './account-deletions'
import { changeKey } from './change-token'
import { deletionKey } from './deletion-token'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const ANN = 'ann@example.test'
const MINUTE_MS = 60 * 1000

/** The directory with every query answering `answer`, as a driver that answers an unexpected shape. */
function answering(local: LocalDb, answer: unknown): LocalDb {
  const query = () =>
    Object.assign(Promise.resolve(answer), { retry: () => Promise.resolve(answer) })
  const db = new Proxy(local.db, {
    get(target, property) {
      if (property === 'query') {
        return query
      }

      const value: unknown = Reflect.get(target, property)

      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })

  return { ...local, db }
}

async function harness() {
  const opened = await openAuth()

  closers.push(opened.close)

  const { accountDeletions } = accountServicesOf(opened)
  const { user } = await signUpOn(opened.auth, ANN, deviceHeaders('laptop'))
  const identity = idSchemas.identity.schema.parse(user.id)
  const claimsOf = async (token: string) => {
    const read = (await accountDeletions.read(token))._unsafeUnwrap()

    return read.kind === 'deletion' ? read.claims : expect.unreachable('a deletion')
  }

  return { ...opened, accountDeletions, identity, claimsOf }
}

describe('AccountDeletions', () => {
  it('reads the deletion a token names, until an hour after it was asked on the gateway clock', async () => {
    const { accountDeletions, identity, clock } = await harness()
    const token = (await accountDeletions.ask(identity))._unsafeUnwrap()
    const asked = clock.now()

    expect((await accountDeletions.read(token))._unsafeUnwrap()).toMatchObject({
      kind: 'deletion',
      claims: { purpose: 'delete-account', identity, at: asked },
    })

    await clock.advance(DELETION_LINK_LIFETIME_MS - MINUTE_MS)
    expect((await accountDeletions.read(token))._unsafeUnwrap().kind).toBe('deletion')
    await clock.advance(MINUTE_MS)
    expect((await accountDeletions.read(token))._unsafeUnwrap()).toEqual({ kind: 'expired' })
  })

  it('reads a token not signed as a deletion token, or not a token at all, as invalid', async () => {
    const { accountDeletions, identity } = await harness()
    const claims = { purpose: 'delete-account', identity, jti: 'a-deletion', at: Date.now() }

    for (const token of [
      await signJWT(claims, AUTH_SECRET),
      await signJWT(claims, changeKey(AUTH_SECRET)),
      await signJWT(claims, deletionKey('another-secret-0123456789-0123456789')),
      await signJWT({ ...claims, purpose: 'change-email' }, deletionKey(AUTH_SECRET)),
      'not-a-token',
    ]) {
      expect((await accountDeletions.read(token))._unsafeUnwrap()).toEqual({ kind: 'invalid' })
    }
  })

  it('spends a deletion once, a newer one replacing it, a cancel ending it', async () => {
    const { accountDeletions, identity, claimsOf } = await harness()
    const first = await claimsOf((await accountDeletions.ask(identity))._unsafeUnwrap())
    const second = await claimsOf((await accountDeletions.ask(identity))._unsafeUnwrap())

    expect((await accountDeletions.claim(first))._unsafeUnwrap()).toBe(false)

    const claims = await Promise.all([
      accountDeletions.claim(second),
      accountDeletions.claim(second),
    ])

    expect(claims.map((claim) => claim._unsafeUnwrap()).sort()).toEqual([false, true])
    expect((await accountDeletions.claim(second))._unsafeUnwrap()).toBe(false)

    const third = await claimsOf((await accountDeletions.ask(identity))._unsafeUnwrap())

    ;(await accountDeletions.cancel(identity))._unsafeUnwrap()
    expect((await accountDeletions.claim(third))._unsafeUnwrap()).toBe(false)
  })

  it("spends no deletion past its hour on the gateway's clock, however late the claim comes", async () => {
    const { accountDeletions, identity, claimsOf, clock } = await harness()
    const expired = await claimsOf((await accountDeletions.ask(identity))._unsafeUnwrap())

    await clock.advance(DELETION_LINK_LIFETIME_MS)
    expect((await accountDeletions.claim(expired))._unsafeUnwrap()).toBe(false)

    const pending = await claimsOf((await accountDeletions.ask(identity))._unsafeUnwrap())

    await clock.advance(DELETION_LINK_LIFETIME_MS - 1)
    expect((await accountDeletions.claim(pending))._unsafeUnwrap()).toBe(true)
  })

  it('answers a data error, not false, for an answer of the directory that is not a list of rows', async () => {
    const { local, clock, identity, claimsOf, accountDeletions } = await harness()
    const claims = await claimsOf((await accountDeletions.ask(identity))._unsafeUnwrap())
    const claimOn = (answer: unknown) =>
      new AccountDeletions({
        directory: answering(local, answer),
        secret: AUTH_SECRET,
        clock,
      }).claim(claims)

    for (const answer of [[], [undefined], [null], [{}], ['deleted'], [[1]]]) {
      expect((await claimOn(answer))._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
    }

    expect((await claimOn([[]]))._unsafeUnwrap()).toBe(false)
    expect((await claimOn([[{ id: 'verification:one' }]]))._unsafeUnwrap()).toBe(true)
  })
})
