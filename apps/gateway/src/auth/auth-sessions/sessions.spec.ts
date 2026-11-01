import { signJWT } from 'better-auth/crypto'
import { afterEach, describe, expect, it } from 'vitest'

import { fromDriverValue, type LocalDb } from '@workspace/data'
import { device_sessionIdFactory, type IdentityId, idSchemas } from '@workspace/ids'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { AUTH_SECRET, deviceHeaders, openAuth, signUpOn } from '../__fixtures__/auth-instance'
import deviceSessionExpiriesStatement from '../__fixtures__/device-session-expiries.surql'
import deviceSessionRowStatement from '../__fixtures__/device-session-row.surql'

import type { SessionCaller, SessionRead } from './read'
import { AuthSessions } from './sessions'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const MINUTE_MS = 60_000

const NONE: SessionRead = { kind: 'none' }

/** A Better Auth instance and the sessions read and ended over its directory, on its clock. */
async function harness() {
  const opened = await openAuth()

  closers.push(opened.close)

  return {
    ...opened,
    sessions: new AuthSessions({
      auth: opened.auth,
      directory: opened.local,
      clock: opened.clock,
      secret: AUTH_SECRET,
    }),
  }
}

/** The identity id the sign-up answered with, as the gateway types it. */
const identityOf = (id: string): IdentityId => idSchemas.identity.schema.parse(id)

/** The caller a read found; the test fails when it found none. */
function callerOf(read: SessionRead): SessionCaller {
  return read.kind === 'session' ? read.caller : expect.unreachable(`a session, read ${read.kind}`)
}

/**
 * Signs Ann up on her laptop, which signs nothing in and mails her the verification link: the
 * token of its link.
 */
async function annsLinkToken(opened: Awaited<ReturnType<typeof harness>>): Promise<string> {
  await opened.auth.api.signUpEmail({
    body: { name: 'Ann', email: 'ann@example.test', password: 'Pass-word-1' },
    headers: deviceHeaders('laptop'),
  })

  return linkToken(await opened.outbox.next('ann@example.test'))
}

/** When each session row ends or ended, by its token. */
async function expiries(local: LocalDb): Promise<Map<string, unknown>> {
  const [rows] = await local.db.query<[{ token: string; expires_at: unknown }[]]>(
    deviceSessionExpiriesStatement,
  )

  return new Map(rows.map((row) => [row.token, fromDriverValue(row.expires_at)]))
}

describe('AuthSessions', () => {
  it('reads the caller of a live session: its identity, email, device and row', async () => {
    const { auth, sessions } = await harness()
    const { token, user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    const read = await sessions.read(token)
    const caller = callerOf(read)

    expect(caller.session).toMatch(/^dvs_/)
    expect(read).toEqual({
      kind: 'session',
      caller: {
        identity: user.id,
        email: 'ann@example.test',
        device: 'laptop',
        session: caller.session,
      },
    })
  })

  it('reads no session for a token nobody holds, or one no header can carry', async () => {
    const { sessions } = await harness()

    expect(await sessions.read('nonsense')).toEqual(NONE)
    expect(await sessions.read('two\nlines')).toEqual(NONE)
  })

  it('reads no session for the signed form of a token, which no ending would match', async () => {
    const { auth, sessions } = await harness()

    await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    const { headers, response } = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('laptop'),
      returnHeaders: true,
    })
    const signed = headers.get('set-auth-token') ?? expect.unreachable('a signed token')
    const raw = response.token

    // Better Auth takes either form; the gateway ends a session by its raw token only.
    expect(signed.startsWith(`${raw}.`)).toBe(true)
    expect(
      await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${signed}` }) }),
    ).not.toBeNull()
    expect(await sessions.read(signed)).toEqual(NONE)
    expect(callerOf(await sessions.read(raw)).device).toBe('laptop')
  })

  it('refuses a session row whose key is not a device session id', async () => {
    const { auth, local, sessions } = await harness()
    const { user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    await local.db.query(deviceSessionRowStatement, {
      identity: user.id,
      device: 'laptop',
      key: 'not-ours',
      session_token: 'a-token-of-another-key',
      created_at: new Date(),
    })

    const read = await sessions.read('a-token-of-another-key')

    expect(read.kind).toBe('failed')
    expect(read.kind === 'failed' ? read.error.code : undefined).toBe('data:AUTH_FAILED')
  })

  it('ends the session a token names at sign-out, keeping its row and its end', async () => {
    const { auth, local, clock, sessions } = await harness()
    const { token } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    await clock.advance(MINUTE_MS)

    const endedAt = new Date(clock.now())

    expect((await sessions.signOut(token))._unsafeUnwrap()).toBe('ended')
    expect(await sessions.read(token)).toEqual(NONE)

    await clock.advance(MINUTE_MS)
    // Signing out again changes nothing: the row keeps the end it has.
    expect((await sessions.signOut(token))._unsafeUnwrap()).toBe('not-live')
    expect((await sessions.signOut('nonsense'))._unsafeUnwrap()).toBe('not-live')

    expect(await expiries(local)).toEqual(new Map([[token, endedAt]]))
  })

  it("ends one session of the identity by its row, and none of another identity's", async () => {
    const { auth, clock, sessions } = await harness()
    const laptop = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const phone = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('phone'),
    })
    const bob = await signUpOn(auth, 'bob@example.test', deviceHeaders('desk'))
    const ann = identityOf(laptop.user.id)
    const phoneRow = callerOf(await sessions.read(phone.token)).session

    expect((await sessions.revoke(identityOf(bob.user.id), phoneRow))._unsafeUnwrap()).toEqual({
      kind: 'missing',
    })
    expect((await sessions.revoke(ann, device_sessionIdFactory.create()))._unsafeUnwrap()).toEqual({
      kind: 'missing',
    })
    expect((await sessions.read(phone.token)).kind).toBe('session')

    await clock.advance(MINUTE_MS)

    const endedAt = new Date(clock.now())
    const ended = (await sessions.revoke(ann, phoneRow))._unsafeUnwrap()

    expect(ended).toMatchObject({
      kind: 'ended',
      row: { id: phoneRow, identity: ann, device: 'phone', expiresAt: endedAt },
    })
    expect(await sessions.read(phone.token)).toEqual(NONE)
    expect(callerOf(await sessions.read(laptop.token)).device).toBe('laptop')
    expect(callerOf(await sessions.read(bob.token)).device).toBe('desk')

    await clock.advance(MINUTE_MS)

    // Asked again, the row answers with the end it has, ended earlier.
    expect((await sessions.revoke(ann, phoneRow))._unsafeUnwrap()).toMatchObject({
      kind: 'already-ended',
      row: { id: phoneRow, expiresAt: endedAt },
    })
  })

  it('ends every live session of the identity, an ended one keeping its end', async () => {
    const { auth, local, clock, sessions } = await harness()
    const laptop = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const phone = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('phone'),
    })
    const tablet = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('tablet'),
    })
    const bob = await signUpOn(auth, 'bob@example.test', deviceHeaders('desk'))

    await clock.advance(MINUTE_MS)

    const tabletEnd = new Date(clock.now())

    ;(await sessions.signOut(tablet.token))._unsafeUnwrap()
    await clock.advance(MINUTE_MS)

    const allEnd = new Date(clock.now())

    ;(await sessions.revokeAll(identityOf(laptop.user.id)))._unsafeUnwrap()

    expect(await sessions.read(laptop.token)).toEqual(NONE)
    expect(await sessions.read(phone.token)).toEqual(NONE)
    expect(callerOf(await sessions.read(bob.token)).device).toBe('desk')

    const ends = await expiries(local)

    expect(ends.get(laptop.token)).toEqual(allEnd)
    expect(ends.get(phone.token)).toEqual(allEnd)
    expect(ends.get(tablet.token)).toEqual(tabletEnd)
  })

  it('fails to read or end a session once the directory is closed', async () => {
    const { auth, local, sessions } = await harness()
    const { token, user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const ann = identityOf(user.id)
    const row = callerOf(await sessions.read(token)).session

    await local.close()

    const read = await sessions.read(token)

    expect(read.kind).toBe('failed')
    expect(read.kind === 'failed' ? read.error.code : undefined).toBe('data:QUERY_FAILED')
    expect((await sessions.signOut(token))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect((await sessions.revoke(ann, row))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect((await sessions.revokeAll(ann))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
  })
})

describe('AuthSessions, the reads of a verification', () => {
  it('reads the session a verification signed in by the signed token of its answer: the raw token and the account', async () => {
    const opened = await harness()
    const token = await annsLinkToken(opened)
    const { headers } = await opened.auth.api.verifyEmail({
      query: { token },
      headers: deviceHeaders('phone', 'Phone'),
      returnHeaders: true,
    })
    const signed = headers.get('set-auth-token') ?? expect.unreachable('a signed token')
    const read = (await opened.sessions.signedIn(signed))._unsafeUnwrap()
    const raw = read?.token ?? expect.unreachable('a session')

    expect(raw).not.toContain('.')
    expect(signed.startsWith(`${raw}.`)).toBe(true)
    expect(read).toEqual({
      token: raw,
      user: {
        id: (await opened.sessions.identityOf('ann@example.test'))._unsafeUnwrap(),
        email: 'ann@example.test',
        name: 'Ann',
        locale: 'en',
      },
    })
    expect(callerOf(await opened.sessions.read(raw)).device).toBe('phone')
    expect((await opened.sessions.signedIn('made.up'))._unsafeUnwrap()).toBeUndefined()
  })

  it('reads the identity of an email in any case, and none for an email no account has', async () => {
    const { auth, sessions } = await harness()
    const { user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    expect((await sessions.identityOf('Ann@Example.test'))._unsafeUnwrap()).toBe(user.id)
    expect((await sessions.identityOf('nobody@example.test'))._unsafeUnwrap()).toBeUndefined()
  })

  it("reads the email of a link's token, and none for a token it did not sign or one past its lifetime", async () => {
    const opened = await harness()
    const token = await annsLinkToken(opened)
    const otherSecret = await signJWT(
      { email: 'ann@example.test' },
      'another-secret-'.padEnd(44, '0'),
    )
    const expired = await signJWT({ email: 'ann@example.test' }, AUTH_SECRET, -10)

    expect(await opened.sessions.verificationEmail(token)).toBe('ann@example.test')
    expect(await opened.sessions.verificationEmail('not-a-token')).toBeUndefined()
    expect(await opened.sessions.verificationEmail(otherSecret)).toBeUndefined()
    expect(await opened.sessions.verificationEmail(expired)).toBeUndefined()
  })

  it('reads an email in lower case, and none from a token that names no email', async () => {
    const { sessions } = await harness()

    expect(
      await sessions.verificationEmail(await signJWT({ email: 'Ann@Example.test' }, AUTH_SECRET)),
    ).toBe('ann@example.test')
    expect(
      await sessions.verificationEmail(await signJWT({ sub: 'ann' }, AUTH_SECRET)),
    ).toBeUndefined()
  })

  it('fails to read a verification session or an identity once the directory is closed', async () => {
    const opened = await harness()
    const token = await annsLinkToken(opened)
    const { headers } = await opened.auth.api.verifyEmail({
      query: { token },
      headers: deviceHeaders('phone', 'Phone'),
      returnHeaders: true,
    })
    const signed = headers.get('set-auth-token') ?? expect.unreachable('a signed token')

    await opened.local.close()

    expect((await opened.sessions.signedIn(signed))._unsafeUnwrapErr().code).toBe(
      'data:QUERY_FAILED',
    )
    expect((await opened.sessions.identityOf('ann@example.test'))._unsafeUnwrapErr().code).toBe(
      'data:QUERY_FAILED',
    )
  })
})
