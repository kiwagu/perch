import { afterEach, describe, expect, it } from 'vitest'

import { type IdentityId, idSchemas } from '@workspace/ids'

import { linkToken } from '../mail/__fixtures__/outbox'

import { accountServicesOf, deviceHeaders, openAuth, signUpOn } from './__fixtures__/auth-instance'
import pendingChangeStatement from './__fixtures__/email-change-pending.surql'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const ANN = 'ann@example.test'
const PASSWORD = 'Pass-word-1'
const NEW_PASSWORD = 'New-pass-word-2'

/** Ann signed up and verified on her laptop, signed in on her phone, and her password services. */
async function harness() {
  const opened = await openAuth()

  closers.push(opened.close)

  const services = accountServicesOf(opened)
  const laptop = await signUpOn(opened.auth, ANN, deviceHeaders('laptop'))
  const phone = await opened.auth.api.signInEmail({
    body: { email: ANN, password: PASSWORD },
    headers: deviceHeaders('phone'),
  })
  const identity: IdentityId = idSchemas.identity.schema.parse(laptop.user.id)
  const sessions = { laptop: laptop.token, phone: phone.token }
  const live = async (token: string): Promise<boolean> =>
    (await opened.auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    })) !== null
  const sessionOf = async (token: string) => {
    const read = await opened.auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    })

    return idSchemas.device_session.schema.parse(read?.session.id)
  }
  const resetLink = async (): Promise<string> => {
    const seen = opened.outbox.to(ANN).length

    expect((await services.passwords.requestReset(ANN))._unsafeUnwrap()).toBe('asked')

    return linkToken(await opened.outbox.next(ANN, seen))
  }
  const pending = async (): Promise<unknown[]> => {
    const [rows] = await opened.local.db.query<[unknown[]]>(pendingChangeStatement, { identity })

    return rows
  }

  return { ...opened, ...services, identity, sessions, live, sessionOf, resetLink, pending }
}

describe('AccountPasswords', () => {
  it('asks for a reset mail for any email, and refuses one that is not an email', async () => {
    const { passwords } = await harness()

    expect((await passwords.requestReset(ANN))._unsafeUnwrap()).toBe('asked')
    expect((await passwords.requestReset('ghost@example.test'))._unsafeUnwrap()).toBe('asked')
    expect((await passwords.requestReset('not an email'))._unsafeUnwrap()).toBe('refused')
  })

  it("checks a password against the account's credential row", async () => {
    const { passwords, identity } = await harness()

    expect((await passwords.matches(identity, PASSWORD))._unsafeUnwrap()).toBe(true)
    expect((await passwords.matches(identity, 'Wrong-pass-1'))._unsafeUnwrap()).toBe(false)
    expect(
      (
        await passwords.matches(
          idSchemas.identity.schema.parse('idn_0000000000000000.0000000000'),
          PASSWORD,
        )
      )._unsafeUnwrap(),
    ).toBe(false)
  })

  it('resets the password with a live link, spending it and every other one, ending every session and the pending change', async () => {
    const { passwords, emailChanges, identity, sessions, live, resetLink, pending, resets } =
      await harness()
    const token = await resetLink()

    ;(await emailChanges.ask(identity, ANN, 'ann.new@example.test'))._unsafeUnwrap()

    const hash = (await passwords.hash(NEW_PASSWORD))._unsafeUnwrap()

    expect((await passwords.reset(identity, 'no-such-token', hash))._unsafeUnwrap()).toBe(
      'link-invalid',
    )
    expect((await passwords.reset(identity, token, hash))._unsafeUnwrap()).toBe('reset')
    expect((await resets.read(token))._unsafeUnwrap()).toBeUndefined()
    expect(await live(sessions.laptop)).toBe(false)
    expect(await live(sessions.phone)).toBe(false)
    expect(await pending()).toEqual([])
    expect((await passwords.matches(identity, NEW_PASSWORD))._unsafeUnwrap()).toBe(true)
    expect((await passwords.reset(identity, token, hash))._unsafeUnwrap()).toBe('link-invalid')
  })

  it('answers link-expired for a link past its hour on the clock, changing nothing', async () => {
    const { passwords, identity, sessions, live, resetLink, resets, clock } = await harness()
    const token = await resetLink()
    const link = (await resets.read(token))._unsafeUnwrap() ?? expect.unreachable('a link')
    const hash = (await passwords.hash(NEW_PASSWORD))._unsafeUnwrap()

    await clock.advance(link.expiresAt.getTime() - clock.now())

    expect((await passwords.reset(identity, token, hash))._unsafeUnwrap()).toBe('link-expired')
    expect((await resets.read(token))._unsafeUnwrap()).toBeDefined()
    expect(await live(sessions.laptop)).toBe(true)
    expect((await passwords.matches(identity, PASSWORD))._unsafeUnwrap()).toBe(true)
  })

  it('changes the password for a live session, ending the other sessions, the reset links and the pending change', async () => {
    const {
      passwords,
      emailChanges,
      identity,
      sessions,
      live,
      sessionOf,
      resetLink,
      pending,
      resets,
    } = await harness()
    const token = await resetLink()
    const laptop = await sessionOf(sessions.laptop)

    ;(await emailChanges.ask(identity, ANN, 'ann.new@example.test'))._unsafeUnwrap()

    expect(
      (await passwords.change(identity, laptop, 'Wrong-pass-1', NEW_PASSWORD))._unsafeUnwrap(),
    ).toEqual({
      kind: 'wrong-password',
    })
    expect(await live(sessions.phone)).toBe(true)
    expect(
      (await passwords.change(identity, laptop, PASSWORD, NEW_PASSWORD))._unsafeUnwrap(),
    ).toEqual({
      kind: 'changed',
      devices: ['phone'],
    })
    expect(await live(sessions.laptop)).toBe(true)
    expect(await live(sessions.phone)).toBe(false)
    expect((await resets.read(token))._unsafeUnwrap()).toBeUndefined()
    expect(await pending()).toEqual([])
    expect((await passwords.matches(identity, NEW_PASSWORD))._unsafeUnwrap()).toBe(true)
  })

  it('changes nothing for a session that is no longer live', async () => {
    const { passwords, identity, sessions, live, sessionOf, auth } = await harness()
    const laptop = await sessionOf(sessions.laptop)

    await auth.api.signOut({ headers: new Headers({ authorization: `Bearer ${sessions.laptop}` }) })

    expect(
      (await passwords.change(identity, laptop, PASSWORD, NEW_PASSWORD))._unsafeUnwrap(),
    ).toEqual({
      kind: 'unauthorized',
    })
    expect(await live(sessions.phone)).toBe(true)
    expect((await passwords.matches(identity, PASSWORD))._unsafeUnwrap()).toBe(true)
  })
})
