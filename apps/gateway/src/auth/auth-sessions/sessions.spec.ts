import { signJWT } from 'better-auth/crypto'
import { afterEach, describe, expect, it } from 'vitest'

import { fromDriverValue, type LocalDb } from '@workspace/data'
import {
  device_sessionIdFactory,
  type IdentityId,
  identityIdFactory,
  idSchemas,
} from '@workspace/ids'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { ban, sessionState, setBanned } from '../__fixtures__/account-ban'
import {
  AUTH_SECRET,
  betterAuthToken,
  deviceHeaders,
  openAuth,
  signUpOn,
} from '../__fixtures__/auth-instance'
import deviceSessionExpiriesStatement from '../__fixtures__/device-session-expiries.surql'
import deviceSessionRowStatement from '../__fixtures__/device-session-row.surql'
import { signVerificationToken, verificationKey } from '../account-links'
import { ADMISSION_HEADER } from '../session-hooks'

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
 * token of its link, which names her account beside Better Auth's own token.
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

/**
 * Signs Ann up and verified on her laptop, then in on her phone as the gateway's sign-in route
 * asks Better Auth to (`X-Perch-Admission: pending`): her identity and the raw token of the phone's
 * session, which waits for its admission.
 */
async function annWaitingOnPhone(opened: Awaited<ReturnType<typeof harness>>) {
  const laptop = await signUpOn(opened.auth, 'ann@example.test', deviceHeaders('laptop'))
  const headers = deviceHeaders('phone')

  headers.set(ADMISSION_HEADER, 'pending')

  const phone = await opened.auth.api.signInEmail({
    body: { email: 'ann@example.test', password: 'Pass-word-1' },
    headers,
  })

  return { identity: identityOf(laptop.user.id), laptop: laptop.token, phone: phone.token }
}

describe("AuthSessions, a sign-in's admission and the ban", () => {
  it('reads a sign-in waiting for its admission as no session, and as its caller once admitted', async () => {
    const opened = await harness()
    const ann = await annWaitingOnPhone(opened)

    expect(await opened.sessions.read(ann.phone)).toEqual(NONE)
    expect((await opened.sessions.admit(ann.identity, ann.phone, false))._unsafeUnwrap()).toEqual({
      kind: 'admitted',
    })
    expect(callerOf(await opened.sessions.read(ann.phone))).toMatchObject({
      identity: ann.identity,
      device: 'phone',
    })
  })

  it('answers banned for a sign-in of an account banned once its session was written, and ends that session banned', async () => {
    const opened = await harness()
    const ann = await annWaitingOnPhone(opened)

    // The ban committed between Better Auth's read of the account and the session's insert: the
    // flag is set and the waiting session, written after it, is still live.
    await setBanned(opened.local, ann.identity, true)
    await opened.clock.advance(MINUTE_MS)

    const admittedAt = new Date(opened.clock.now())

    expect((await opened.sessions.admit(ann.identity, ann.phone, false))._unsafeUnwrap()).toEqual({
      kind: 'banned',
    })
    expect(await sessionState(opened.local, ann.identity, ann.phone)).toEqual({
      device: 'phone',
      token: ann.phone,
      pending: true,
      ended_at: admittedAt,
      ended_reason: 'banned',
    })
    expect(await opened.sessions.read(ann.phone)).toEqual(NONE)
  })

  it('answers banned for a sign-in whose waiting session the ban ended, leaving the session as the ban left it', async () => {
    const opened = await harness()
    const ann = await annWaitingOnPhone(opened)

    await opened.clock.advance(MINUTE_MS)

    const bannedAt = new Date(opened.clock.now())

    await ban(opened.local, ann.identity, bannedAt)
    await opened.clock.advance(MINUTE_MS)

    expect((await opened.sessions.admit(ann.identity, ann.phone, false))._unsafeUnwrap()).toEqual({
      kind: 'banned',
    })
    expect(await sessionState(opened.local, ann.identity, ann.phone)).toEqual({
      device: 'phone',
      token: ann.phone,
      pending: true,
      ended_at: bannedAt,
      ended_reason: 'banned',
    })
  })

  it('leaves to the ban a sign-in admitted before it: the ban ends the admitted session banned', async () => {
    const opened = await harness()
    const ann = await annWaitingOnPhone(opened)

    expect((await opened.sessions.admit(ann.identity, ann.phone, false))._unsafeUnwrap()).toEqual({
      kind: 'admitted',
    })
    await opened.clock.advance(MINUTE_MS)

    const bannedAt = new Date(opened.clock.now())

    await ban(opened.local, ann.identity, bannedAt)

    expect(await sessionState(opened.local, ann.identity, ann.phone)).toEqual({
      device: 'phone',
      token: ann.phone,
      pending: false,
      ended_at: bannedAt,
      ended_reason: 'banned',
    })
    expect(await opened.sessions.read(ann.phone)).toEqual(NONE)
  })
})

/**
 * Signs Ann up on her laptop and verifies her email on her phone, as Better Auth's verification
 * does before the gateway admits its session: her identity and the raw token of the phone's
 * session, read back by the signed token of Better Auth's answer.
 */
async function annVerifyingOnPhone(opened: Awaited<ReturnType<typeof harness>>) {
  const token = await annsLinkToken(opened)
  const { headers } = await opened.auth.api.verifyEmail({
    query: { token: betterAuthToken(token) },
    headers: deviceHeaders('phone'),
    returnHeaders: true,
  })
  const signed = headers.get('set-auth-token') ?? expect.unreachable('a signed token')
  const read =
    (await opened.sessions.signedIn(signed))._unsafeUnwrap() ?? expect.unreachable('a session')

  return { identity: identityOf(read.user.id), phone: read.token }
}

describe("AuthSessions, a verification's admission and the ban", () => {
  it('admits the waiting session of a verification, which then reads as its caller and is the newest its device keeps', async () => {
    const opened = await harness()
    const token = await annsLinkToken(opened)
    const ann = (await opened.sessions.identityOf('ann@example.test'))._unsafeUnwrap()
    const identity = ann ?? expect.unreachable('an account')

    // The phone holds an earlier admitted session of the account.
    await opened.local.db.query(deviceSessionRowStatement, {
      identity,
      device: 'phone',
      key: device_sessionIdFactory.create(),
      session_token: 'earlier-token',
      created_at: new Date(Date.now() - MINUTE_MS),
    })

    const { headers } = await opened.auth.api.verifyEmail({
      query: { token: betterAuthToken(token) },
      headers: deviceHeaders('phone'),
      returnHeaders: true,
    })
    const signed = headers.get('set-auth-token') ?? expect.unreachable('a signed token')
    const raw =
      (await opened.sessions.signedIn(signed))._unsafeUnwrap()?.token ??
      expect.unreachable('a session')

    // Until its admission the new session ends nothing, and no caller reads it.
    expect(await sessionState(opened.local, identity, 'earlier-token')).toMatchObject({
      pending: false,
    })
    expect((await sessionState(opened.local, identity, 'earlier-token')).ended_at).toBeUndefined()
    expect(await sessionState(opened.local, identity, raw)).toMatchObject({ pending: true })
    expect(await opened.sessions.read(raw)).toEqual(NONE)

    await opened.clock.advance(MINUTE_MS)

    const admittedAt = new Date(opened.clock.now())

    expect((await opened.sessions.admitVerified(identity, raw))._unsafeUnwrap()).toEqual({
      kind: 'admitted',
    })
    expect(await sessionState(opened.local, identity, 'earlier-token')).toEqual({
      device: 'phone',
      token: 'earlier-token',
      pending: false,
      ended_at: admittedAt,
    })
    expect(await sessionState(opened.local, identity, raw)).toEqual({
      device: 'phone',
      token: raw,
      pending: false,
    })
    expect(callerOf(await opened.sessions.read(raw))).toMatchObject({ identity, device: 'phone' })
  })

  it('answers banned for a verification of an account banned once its session was written, and ends that session banned', async () => {
    const opened = await harness()
    const ann = await annVerifyingOnPhone(opened)

    await setBanned(opened.local, ann.identity, true)
    await opened.clock.advance(MINUTE_MS)

    const admittedAt = new Date(opened.clock.now())

    expect((await opened.sessions.admitVerified(ann.identity, ann.phone))._unsafeUnwrap()).toEqual({
      kind: 'banned',
    })
    expect(await sessionState(opened.local, ann.identity, ann.phone)).toEqual({
      device: 'phone',
      token: ann.phone,
      pending: true,
      ended_at: admittedAt,
      ended_reason: 'banned',
    })
    expect(await opened.sessions.read(ann.phone)).toEqual(NONE)
  })

  it('answers banned for a verification whose waiting session the ban ended, leaving the session as the ban left it', async () => {
    const opened = await harness()
    const ann = await annVerifyingOnPhone(opened)

    await opened.clock.advance(MINUTE_MS)

    const bannedAt = new Date(opened.clock.now())

    await ban(opened.local, ann.identity, bannedAt)
    await opened.clock.advance(MINUTE_MS)

    expect((await opened.sessions.admitVerified(ann.identity, ann.phone))._unsafeUnwrap()).toEqual({
      kind: 'banned',
    })
    expect(await sessionState(opened.local, ann.identity, ann.phone)).toEqual({
      device: 'phone',
      token: ann.phone,
      pending: true,
      ended_at: bannedAt,
      ended_reason: 'banned',
    })
  })

  it('answers gone for a verification whose waiting session an ending of every session ended, as a reset does, admitting nothing', async () => {
    const opened = await harness()
    const ann = await annVerifyingOnPhone(opened)

    await opened.clock.advance(MINUTE_MS)

    const endedAt = new Date(opened.clock.now())

    ;(await opened.sessions.revokeAll(ann.identity))._unsafeUnwrap()
    await opened.clock.advance(MINUTE_MS)

    expect((await opened.sessions.admitVerified(ann.identity, ann.phone))._unsafeUnwrap()).toEqual({
      kind: 'gone',
    })
    expect(await sessionState(opened.local, ann.identity, ann.phone)).toEqual({
      device: 'phone',
      token: ann.phone,
      pending: true,
      ended_at: endedAt,
      ended_reason: 'revoked',
    })
    expect(await opened.sessions.read(ann.phone)).toEqual(NONE)
  })
})

describe('AuthSessions, the reads of a verification', () => {
  it('reads the session a verification signed in by the signed token of its answer: the raw token and the account', async () => {
    const opened = await harness()
    const token = await annsLinkToken(opened)
    const { headers } = await opened.auth.api.verifyEmail({
      query: { token: betterAuthToken(token) },
      headers: deviceHeaders('phone', 'Phone'),
      returnHeaders: true,
    })
    const signed = headers.get('set-auth-token') ?? expect.unreachable('a signed token')
    const read =
      (await opened.sessions.signedIn(signed))._unsafeUnwrap() ?? expect.unreachable('a session')
    const raw = read.token

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
    // The session waits for the gateway's admission: no caller reads it until then.
    expect(await opened.sessions.read(raw)).toEqual(NONE)
    expect(
      (await opened.sessions.admitVerified(identityOf(read.user.id), raw))._unsafeUnwrap(),
    ).toEqual({ kind: 'admitted' })
    expect(callerOf(await opened.sessions.read(raw)).device).toBe('phone')
    expect((await opened.sessions.signedIn('made.up'))._unsafeUnwrap()).toBeUndefined()
  })

  it('reads the identity of an email in any case, and none for an email no account has', async () => {
    const { auth, sessions } = await harness()
    const { user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    expect((await sessions.identityOf('Ann@Example.test'))._unsafeUnwrap()).toBe(user.id)
    expect((await sessions.identityOf('nobody@example.test'))._unsafeUnwrap()).toBeUndefined()
  })

  it("reads what a link's token names: the account its mail went to, Better Auth's token and its email", async () => {
    const opened = await harness()
    const token = await annsLinkToken(opened)

    expect(await opened.sessions.verificationOf(token)).toEqual({
      identity: (await opened.sessions.identityOf('ann@example.test'))._unsafeUnwrap(),
      token: betterAuthToken(token),
      email: 'ann@example.test',
    })
  })

  it("reads none for a token the gateway did not sign as a link's: Better Auth's own, one signed with the secret itself or another key, a confirmation's", async () => {
    const opened = await harness()
    const token = await annsLinkToken(opened)
    const claims = {
      purpose: 'verify-email',
      identity: identityIdFactory.create(),
      token: betterAuthToken(token),
    } as const
    const key = verificationKey(AUTH_SECRET)

    expect(await opened.sessions.verificationOf(betterAuthToken(token))).toBeUndefined()
    expect(await opened.sessions.verificationOf('not-a-token')).toBeUndefined()
    expect(
      await opened.sessions.verificationOf(await signVerificationToken(claims, AUTH_SECRET)),
    ).toBeUndefined()
    expect(
      await opened.sessions.verificationOf(
        await signVerificationToken(claims, verificationKey('another-secret-'.padEnd(44, '0'))),
      ),
    ).toBeUndefined()
    expect(
      await opened.sessions.verificationOf(
        await signJWT({ ...claims, purpose: 'change-email' }, key),
      ),
    ).toBeUndefined()
  })

  it("reads the email of Better Auth's token in lower case, and none once that token is past its lifetime or names no email", async () => {
    const { sessions } = await harness()
    const identity = identityIdFactory.create()
    const key = verificationKey(AUTH_SECRET)
    const linkOf = (token: string) =>
      signVerificationToken({ purpose: 'verify-email', identity, token }, key)
    const upper = await signJWT({ email: 'Ann@Example.test' }, AUTH_SECRET)
    const expired = await signJWT({ email: 'ann@example.test' }, AUTH_SECRET, -10)
    const nameless = await signJWT({ sub: 'ann' }, AUTH_SECRET)

    expect(await sessions.verificationOf(await linkOf(upper))).toEqual({
      identity,
      token: upper,
      email: 'ann@example.test',
    })
    expect(await sessions.verificationOf(await linkOf(expired))).toEqual({
      identity,
      token: expired,
      email: undefined,
    })
    expect(await sessions.verificationOf(await linkOf(nameless))).toEqual({
      identity,
      token: nameless,
      email: undefined,
    })
  })

  it('fails to read a verification session or an identity once the directory is closed', async () => {
    const opened = await harness()
    const token = await annsLinkToken(opened)
    const { headers } = await opened.auth.api.verifyEmail({
      query: { token: betterAuthToken(token) },
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
