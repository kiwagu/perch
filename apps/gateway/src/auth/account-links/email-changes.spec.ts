import { signJWT } from 'better-auth/crypto'
import { afterEach, describe, expect, it } from 'vitest'

import { idSchemas } from '@workspace/ids'

import {
  AUTH_SECRET,
  accountServicesOf,
  deviceHeaders,
  openAuth,
  signUpOn,
} from '../__fixtures__/auth-instance'

import { changeKey } from './change-token'
import { CONFIRMATION_LINK_LIFETIME_MS } from './email-changes'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const ANN = 'ann@example.test'
const NEW_EMAIL = 'ann.new@example.test'

async function harness() {
  const opened = await openAuth()

  closers.push(opened.close)

  const { emailChanges, accountDeletions } = accountServicesOf(opened)
  const { user } = await signUpOn(opened.auth, ANN, deviceHeaders('laptop'))

  return {
    ...opened,
    emailChanges,
    accountDeletions,
    identity: idSchemas.identity.schema.parse(user.id),
  }
}

describe('EmailChanges', () => {
  it('reads the change a token names, until a day after it was asked on the gateway clock', async () => {
    const { emailChanges, identity, clock } = await harness()
    const token = (await emailChanges.ask(identity, ANN, NEW_EMAIL))._unsafeUnwrap()
    const read = (await emailChanges.read(token))._unsafeUnwrap()

    expect(read).toMatchObject({
      kind: 'change',
      claims: { purpose: 'change-email', identity, email: ANN, newEmail: NEW_EMAIL },
    })

    await clock.advance(CONFIRMATION_LINK_LIFETIME_MS - 1)
    expect((await emailChanges.read(token))._unsafeUnwrap().kind).toBe('change')
    await clock.advance(1)
    expect((await emailChanges.read(token))._unsafeUnwrap()).toEqual({ kind: 'expired' })
  })

  it('reads a token signed with the secret itself, or another key, or not a token at all, as invalid', async () => {
    const { emailChanges, identity } = await harness()
    const claims = {
      purpose: 'change-email',
      identity,
      email: ANN,
      newEmail: NEW_EMAIL,
      jti: 'a-change',
      at: Date.now(),
    }

    for (const token of [
      await signJWT(claims, AUTH_SECRET),
      await signJWT(claims, changeKey('another-secret-0123456789-0123456789')),
      await signJWT({ ...claims, purpose: 'reset' }, changeKey(AUTH_SECRET)),
      'not-a-token',
    ]) {
      expect((await emailChanges.read(token))._unsafeUnwrap()).toEqual({ kind: 'invalid' })
    }
  })

  it('spends a change once, a newer change replacing it, a cancel ending it', async () => {
    const { emailChanges, identity } = await harness()
    const claimsOf = async (token: string) => {
      const read = (await emailChanges.read(token))._unsafeUnwrap()

      return read.kind === 'change' ? read.claims : expect.unreachable('a change')
    }
    const first = await claimsOf((await emailChanges.ask(identity, ANN, NEW_EMAIL))._unsafeUnwrap())
    const second = await claimsOf(
      (await emailChanges.ask(identity, ANN, NEW_EMAIL))._unsafeUnwrap(),
    )

    expect((await emailChanges.claim(first))._unsafeUnwrap()).toBe(false)

    const claims = await Promise.all([emailChanges.claim(second), emailChanges.claim(second)])

    expect(claims.map((claim) => claim._unsafeUnwrap()).sort()).toEqual([false, true])

    const third = await claimsOf((await emailChanges.ask(identity, ANN, NEW_EMAIL))._unsafeUnwrap())

    ;(await emailChanges.cancel(identity))._unsafeUnwrap()
    expect((await emailChanges.claim(third))._unsafeUnwrap()).toBe(false)
  })

  it('moves the email only from the email it still has', async () => {
    const { emailChanges, identity } = await harness()

    expect(
      (await emailChanges.move(identity, 'someone@example.test', NEW_EMAIL))._unsafeUnwrap(),
    ).toBe(false)
    expect((await emailChanges.move(identity, ANN, NEW_EMAIL))._unsafeUnwrap()).toBe(true)
    expect((await emailChanges.move(identity, ANN, 'third@example.test'))._unsafeUnwrap()).toBe(
      false,
    )
  })

  it('ends the pending deletion of the account when it moves the email, and only then', async () => {
    const { emailChanges, accountDeletions, identity } = await harness()
    const claimsOf = async (token: string) => {
      const read = (await accountDeletions.read(token))._unsafeUnwrap()

      return read.kind === 'deletion' ? read.claims : expect.unreachable('a deletion')
    }
    const kept = await claimsOf((await accountDeletions.ask(identity))._unsafeUnwrap())

    expect(
      (await emailChanges.move(identity, 'someone@example.test', NEW_EMAIL))._unsafeUnwrap(),
    ).toBe(false)
    expect((await accountDeletions.claim(kept))._unsafeUnwrap()).toBe(true)

    const ended = await claimsOf((await accountDeletions.ask(identity))._unsafeUnwrap())

    expect((await emailChanges.move(identity, ANN, NEW_EMAIL))._unsafeUnwrap()).toBe(true)
    expect((await accountDeletions.claim(ended))._unsafeUnwrap()).toBe(false)
  })
})
