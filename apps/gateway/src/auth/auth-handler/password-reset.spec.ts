import { describe, expect, it, vi } from 'vitest'

import { profileIdFactory } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { betterAuthToken, deviceHeaders } from '../__fixtures__/auth-instance'
import cancelAllowStatement from '../__fixtures__/email-change-cancel-allow.surql'
import cancelRefuseStatement from '../__fixtures__/email-change-cancel-refuse.surql'
import pendingChangeStatement from '../__fixtures__/email-change-pending.surql'
import profileRowStatement from '../__fixtures__/profile-row.surql'
import settingsLocaleStatement from '../__fixtures__/settings-locale.surql'
import { DeviceSessions } from '../device-sessions'

import {
  ANN,
  ARGON2_WAIT,
  annsLink,
  heldQueries,
  holdTurn,
  isSessionInsert,
  mountedOnFakeAuth,
  mountedOnRealAuth,
  PASSWORD,
  pastFloor,
  postTo,
  printedDuring,
  resendRequest,
  signedInOn,
  signInRequest,
  turnsAsked,
} from './__fixtures__/mount'
import { RESET_REQUEST_FLOOR_MS } from './password-reset'

/** The client address a request comes from, unless a test names another. */
const FROM = '203.0.113.7'

/** Another client address, which nothing from `FROM` charges. */
const ELSEWHERE = '203.0.113.8'

/** An email no account has. */
const GHOST = 'ghost@example.test'

/** The new password most tests set, which keeps the rules of a new password. */
const NEW_PASSWORD = 'New-pass-word-2'

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/** A request for a reset mail to `email`. */
const resetRequest = (email: string) => postTo('/auth/request-password-reset', { email })

/** A reset with the link's `token`, from `sender` when one is named. */
const reset = (
  token: string,
  password = NEW_PASSWORD,
  sender?: { device: string; token: string },
) => postTo('/auth/reset-password', { token, password }, sender)

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** Asks for a reset mail to `email` and answers the token of its link, once it was sent. */
async function resetLink(mounted: Mounted, email = ANN, from = FROM): Promise<string> {
  const seen = mounted.outbox.to(email).length
  const answer = await pastFloor(
    mounted.clock,
    mounted.route(resetRequest(email), from),
    RESET_REQUEST_FLOOR_MS,
  )

  expect(answer?.status).toBe(202)

  return linkToken(await mounted.outbox.next(email, seen))
}

/** An answer as a client sees it: its status, its headers and its body. */
async function seen(answer: Response | undefined) {
  return {
    status: answer?.status,
    headers: [...(answer?.headers ?? [])].map(([name]) => name).sort(),
    body: (await answer?.text()) ?? '',
  }
}

describe('authHandler, the request for a reset mail', () => {
  it('answers an email that has an account and one that has none alike, at the floor, and mails only the first, linking to the reset screen', async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    let settled = 0
    const ask = (email: string) =>
      mounted.route(resetRequest(email), FROM).finally(() => {
        settled += 1
      })
    const pending = [ask(ANN), ask(GHOST)]

    await vi.waitFor(() => expect(mounted.clock.pending()).toBe(2))
    await mounted.clock.advance(RESET_REQUEST_FLOOR_MS - 1)
    expect(settled).toBe(0)
    await mounted.clock.advance(1)

    const [known, unknown] = await Promise.all(pending)

    expect(await seen(known)).toEqual({ status: 202, headers: [], body: '' })
    expect(await seen(unknown)).toEqual({ status: 202, headers: [], body: '' })

    const mail = await mounted.outbox.next(ANN, 1)
    const link = new URL(/https?:\/\/\S+/.exec(mail.text)?.[0] ?? expect.unreachable('a link'))

    expect(link.origin + link.pathname).toBe('http://localhost/reset-password')
    expect(link.searchParams.get('token')).toMatch(/.{16,}/)
    expect(mail.subject).toBe('Set a new password for Perch')
    expect(mounted.outbox.to(GHOST)).toEqual([])
  })

  it('writes the reset mail in the language the account signed up in', async () => {
    const mounted = await mountedOnRealAuth()

    await signUpSpanish(mounted)
    await resetLink(mounted)

    expect(mounted.outbox.to(ANN).at(-1)?.subject).toBe('Elige una contraseña nueva para Perch')
  })

  it('takes three requests of one email within a quarter of an hour; the fourth answers rate-limited and sends nothing', async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    for (let n = 0; n < 3; n += 1) {
      await resetLink(mounted, ANN, n === 1 ? ELSEWHERE : FROM)
    }

    const fourth = await mounted.route(resetRequest(ANN.toUpperCase()), FROM)

    expect(fourth?.status).toBe(429)
    expect(await fourth?.json()).toEqual({ code: 'rate-limited' })
    expect(Number(fourth?.headers.get('Retry-After'))).toBeGreaterThan(0)
    // The verification mail, then three reset mails.
    expect(mounted.outbox.to(ANN)).toHaveLength(4)

    await mounted.clock.advance(15 * MINUTE_MS)
    await resetLink(mounted)
  })

  it("takes one of the address's mails, the budget it shares with sign-ups and resends", async () => {
    const { route } = mountedOnFakeAuth(() => new Response(null, { status: 200 }))

    for (let n = 0; n < 200; n += 1) {
      expect((await route(resendRequest(`r${n}@example.test`), FROM))?.status).toBe(202)
    }

    expect((await route(resetRequest(ANN), FROM))?.status).toBe(429)
  })

  it('replaces the earlier links: only the newest sets a password', async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    const first = await resetLink(mounted)
    const second = await resetLink(mounted)

    expect((await mounted.resets.read(first))._unsafeUnwrap()).toBeUndefined()

    const refused = await mounted.route(reset(first), FROM)

    expect(refused?.status).toBe(401)
    expect(await refused?.json()).toEqual({ code: 'link-invalid' })
    expect((await mounted.route(reset(second), FROM))?.status).toBe(200)
  })

  it('answers a body that names no email 400, taking nothing', async () => {
    const { route } = mountedOnFakeAuth(() => new Response(null, { status: 200 }))

    expect((await route(postTo('/auth/request-password-reset', {}), FROM))?.status).toBe(400)
  })
})

describe('authHandler, the reset of a password', () => {
  it('sets the new password and signs every device out, closing their sockets with 4002, the device that opened the link too', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop', 'phone'])
    const token = await resetLink(mounted)
    // The laptop opens the link while it is signed in to the account.
    const answer = await mounted.route(
      reset(token, NEW_PASSWORD, ann.on('laptop') as { device: string; token: string }),
      FROM,
    )

    // The laptop's own session was among those ended: it signs out with no channel to hear it.
    expect(answer?.status).toBe(200)
    expect(await answer?.json()).toEqual({ signedOut: true })

    for (const device of ['laptop', 'phone']) {
      expect(await mounted.sessions.read(ann.tokens.get(device) ?? '')).toEqual({ kind: 'none' })
      expect(ann.sockets.get(device)?.ended).toEqual([CLOSE.passwordChanged])
    }

    expect(mounted.closes).toEqual([[ann.identity, undefined, CLOSE.passwordChanged]])

    // Every device signed out keeps why, for its next hello.
    const devices = new DeviceSessions({ directory: mounted.local, clock: mounted.clock })

    for (const device of ['laptop', 'phone']) {
      const row = (await devices.byToken(ann.tokens.get(device) ?? ''))._unsafeUnwrap()

      expect(row?.endedReason).toBe('password-changed')
    }

    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'laptop'), FROM))?.status).toBe(401)
    expect((await mounted.route(signInRequest(ANN, NEW_PASSWORD, 'laptop'), FROM))?.status).toBe(
      200,
    )
  })

  it("answers that the session the request carries was not ended: another account's, or none", async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    const bob = await signedInOn(mounted, 'bob@example.test', ['desk'])
    // Ann's link opened on Bob's desk, signed in to Bob: the reset ends Ann's sessions only.
    const fromBob = await mounted.route(
      reset(
        await resetLink(mounted),
        NEW_PASSWORD,
        bob.on('desk') as { device: string; token: string },
      ),
      FROM,
    )

    expect(fromBob?.status).toBe(200)
    expect(await fromBob?.json()).toEqual({ signedOut: false })
    expect((await mounted.sessions.read(bob.tokens.get('desk') ?? '')).kind).not.toBe('none')
    // The notice of the changed password goes after the answer: past it, the next mail is the link.
    await mounted.outbox.next(ANN, 2)

    const fromNobody = await mounted.route(reset(await resetLink(mounted)), FROM)

    expect(fromNobody?.status).toBe(200)
    expect(await fromNobody?.json()).toEqual({ signedOut: false })
  })

  it('mails the notice of a changed password to the account, linking to the request for a new one', async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    const token = await resetLink(mounted)

    await mounted.route(reset(token), FROM)

    const notice = await mounted.outbox.next(ANN, 2)

    expect(notice.subject).toBe('Your Perch password was changed')
    expect(notice.text).toContain('http://localhost/forgot-password')
    expect(notice.text).not.toContain(token)
    expect(notice.html).toContain('lang="en"')
  })

  it('spends the link: opened again it answers link-invalid and sets nothing', async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    const token = await resetLink(mounted)

    expect((await mounted.route(reset(token), FROM))?.status).toBe(200)

    const again = await mounted.route(reset(token, 'Other-pass-word-3'), FROM)

    expect(again?.status).toBe(401)
    expect(await again?.json()).toEqual({ code: 'link-invalid' })
    expect((await mounted.route(signInRequest(ANN, NEW_PASSWORD, 'laptop'), FROM))?.status).toBe(
      200,
    )
  })

  it('sets the password once when one link is used twice at once', async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    const token = await resetLink(mounted)
    const answers = await Promise.all([
      mounted.route(reset(token, NEW_PASSWORD), FROM),
      mounted.route(reset(token, 'Other-pass-word-3'), FROM),
    ])

    expect(answers.map((answer) => answer?.status).sort()).toEqual([200, 401])
  })

  it('ends every other reset link and the pending change of the email', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await resetLink(mounted)
    const change = (
      await mounted.emailChanges.ask(ann.identity, ANN, 'ann.new@example.test')
    )._unsafeUnwrap()
    const claims = (await mounted.emailChanges.read(change))._unsafeUnwrap()

    expect((await mounted.route(reset(token), FROM))?.status).toBe(200)
    expect(claims.kind).toBe('change')
    expect(
      claims.kind === 'change'
        ? (await mounted.emailChanges.claim(claims.claims))._unsafeUnwrap()
        : true,
    ).toBe(false)
  })

  it('answers link-expired for a link an hour old, and sets nothing', async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    const before = Date.now()
    const token = await resetLink(mounted)
    const after = Date.now()
    const link = (await mounted.resets.read(token))._unsafeUnwrap() ?? expect.unreachable('a link')

    // Better Auth dates the link an hour after the request, by the system's clock.
    expect(link.expiresAt.getTime()).toBeGreaterThanOrEqual(before + HOUR_MS)
    expect(link.expiresAt.getTime()).toBeLessThanOrEqual(after + HOUR_MS)

    await mounted.clock.advance(link.expiresAt.getTime() - mounted.clock.now())

    const expired = await mounted.route(reset(token), FROM)

    expect(expired?.status).toBe(401)
    expect(await expired?.json()).toEqual({ code: 'link-expired' })
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'laptop'), FROM))?.status).toBe(200)
  })

  it('takes a link a moment before its hour is up', async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    const token = await resetLink(mounted)
    const link = (await mounted.resets.read(token))._unsafeUnwrap() ?? expect.unreachable('a link')

    await mounted.clock.advance(link.expiresAt.getTime() - mounted.clock.now() - 1)

    expect((await mounted.route(reset(token), FROM))?.status).toBe(200)
  })

  it('refuses a password that breaks the rules with password-rejected, keeping the link and the old password', async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    const token = await resetLink(mounted)
    const empty = await mounted.route(reset(token, ''), FROM)

    expect(empty?.status).toBe(400)
    expect(await empty?.json()).toEqual({ code: 'password-rejected' })

    const weak = await mounted.route(reset(token, 'abcdefghij'), FROM)

    expect(weak?.status).toBe(400)
    expect(await weak?.json()).toEqual({ code: 'password-rejected' })
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'laptop'), FROM))?.status).toBe(200)
    expect((await mounted.route(reset(token), FROM))?.status).toBe(200)
  })

  it('answers link-invalid to a token no link holds', async () => {
    const mounted = await mountedOnRealAuth()
    const answer = await mounted.route(reset('no-such-token'), FROM)

    expect(answer?.status).toBe(401)
    expect(await answer?.json()).toEqual({ code: 'link-invalid' })
  })

  it('takes twenty attempts of an address within ten minutes, refused or not, and answers the next rate-limited', async () => {
    const mounted = await mountedOnRealAuth()

    for (let n = 0; n < 20; n += 1) {
      expect((await mounted.route(reset(`no-such-token-${n}`), FROM))?.status).toBe(401)
    }

    const limited = await mounted.route(reset('no-such-token'), FROM)

    expect(limited?.status).toBe(429)
    expect(await limited?.json()).toEqual({ code: 'rate-limited' })
    expect((await mounted.route(reset('no-such-token'), ELSEWHERE))?.status).toBe(401)
    await mounted.clock.advance(10 * MINUTE_MS)
    expect((await mounted.route(reset('no-such-token'), FROM))?.status).toBe(401)
  })

  it('logs, prints and answers nothing of the email, the token or the passwords', async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    const { result: token, printed } = await printedDuring(async () => {
      const link = await resetLink(mounted)

      await mounted.route(reset(link, 'abcdefghij'), FROM)
      await mounted.route(reset(link), FROM)
      await mounted.route(reset(link), FROM)

      return link
    })
    const told = `${printed}\n${JSON.stringify(mounted.logs)}`

    for (const secret of [ANN, token, PASSWORD, NEW_PASSWORD, 'abcdefghij']) {
      expect(told).not.toContain(secret)
    }
  })
})

/** Signs Ann up in Spanish and verifies her, so her mails speak Spanish. */
async function signUpSpanish(mounted: Mounted): Promise<void> {
  const seen = mounted.outbox.to(ANN).length

  await mounted.auth.api.signUpEmail({
    body: { name: 'Ann', email: ANN, password: PASSWORD, locale: 'es' },
    headers: deviceHeaders('laptop'),
  })
  await mounted.auth.api.verifyEmail({
    query: { token: betterAuthToken(linkToken(await mounted.outbox.next(ANN, seen))) },
    headers: deviceHeaders('laptop'),
  })
}

/** What a sign-in answers, as far as these tests read it. */
const signedInAnswer = z.object({ token: z.string().min(1) })

/** The pending change of the email of `identity`, if any. */
async function pendingChange(mounted: Mounted, identity: string): Promise<unknown[]> {
  const [rows] = await mounted.local.db.query<[unknown[]]>(pendingChangeStatement, { identity })

  return rows
}

describe('authHandler, a reset and what runs beside it', () => {
  it('leaves no working session to a sign-in with the old password that checked it before a reset', async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await resetLink(mounted)
    const asked = turnsAsked(mounted.turns)

    const hold = queries.hold(isSessionInsert)

    // A sign-in with the old password has checked it and waits to write its session.
    const signingIn = mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM)

    await vi.waitFor(() => expect(hold.paused()).toBe(true), ARGON2_WAIT)

    let reset = false
    const resetting = mounted
      .route(postTo('/auth/reset-password', { token, password: NEW_PASSWORD }), FROM)
      .finally(() => {
        reset = true
      })

    // The reset either ran to its end, or waits for the account's turn the sign-in holds.
    await vi.waitFor(() => expect(reset || asked(ann.identity) >= 2).toBe(true), ARGON2_WAIT)
    hold.release()

    const [signedIn, answered] = await Promise.all([signingIn, resetting])

    expect(answered?.status).toBe(200)

    if (signedIn?.status === 200) {
      const { token: phone } = signedInAnswer.parse(await signedIn.json())

      expect(await mounted.sessions.read(phone)).toEqual({ kind: 'none' })
    }

    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(401)
  }, 30_000)

  it('answers link-expired to a link that expired while the reset waited for the account', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await resetLink(mounted)
    const link = (await mounted.resets.read(token))._unsafeUnwrap() ?? expect.unreachable('a link')
    const asked = turnsAsked(mounted.turns)
    const release = await holdTurn(mounted.turns, ann.identity)
    const resetting = mounted.route(reset(token), FROM)

    await vi.waitFor(() => expect(asked(ann.identity)).toBe(2), ARGON2_WAIT)
    await mounted.clock.advance(link.expiresAt.getTime() - mounted.clock.now())
    release()

    const expired = await resetting

    expect(expired?.status).toBe(401)
    expect(await expired?.json()).toEqual({ code: 'link-expired' })
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(200)
  })

  it('leaves the password, the link, the sessions and the pending change of the email as they were when a step of the reset fails', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop', 'phone'])
    const token = await resetLink(mounted)

    ;(await mounted.emailChanges.ask(ann.identity, ANN, 'ann.new@example.test'))._unsafeUnwrap()
    await mounted.local.db.query(cancelRefuseStatement)

    const failed = await mounted.route(reset(token), FROM)

    expect(failed?.status).toBe(500)
    expect((await mounted.resets.read(token))._unsafeUnwrap()).toBeDefined()
    expect(await pendingChange(mounted, ann.identity)).toHaveLength(1)

    for (const device of ['laptop', 'phone']) {
      expect((await mounted.sessions.read(ann.tokens.get(device) ?? '')).kind).toBe('session')
      expect(ann.sockets.get(device)?.ended).toEqual([])
    }

    expect(mounted.closes).toEqual([])
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(200)

    // Once the directory takes the step again, the same link sets the password.
    await mounted.local.db.query(cancelAllowStatement)
    expect((await mounted.route(reset(token), FROM))?.status).toBe(200)
    expect(await pendingChange(mounted, ann.identity)).toEqual([])
  })
})

/** What a sign-in answers, with the start it may carry. */
const startAnswer = z.object({
  token: z.string().min(1),
  user: z.object({ id: z.string() }),
  start: z.object({ name: z.string(), locale: z.string() }).optional(),
})

describe('authHandler, a reset of an account not verified yet', () => {
  it('verifies its email: its first sign-ins carry the start of the account, until its profile and settings exist', async () => {
    const mounted = await mountedOnRealAuth()

    await mounted.auth.api.signUpEmail({
      body: { name: 'Ana', email: ANN, password: PASSWORD, locale: 'es' },
      headers: deviceHeaders('laptop'),
    })
    await mounted.outbox.next(ANN)
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'laptop'), FROM))?.status).toBe(403)

    const token = await resetLink(mounted)

    expect((await mounted.route(reset(token), FROM))?.status).toBe(200)

    // Two devices sign in at once: both are told to start the account.
    const answers = await Promise.all(
      ['phone', 'tablet'].map((device) =>
        mounted.route(signInRequest(ANN, NEW_PASSWORD, device), FROM),
      ),
    )

    for (const answer of answers) {
      expect(answer?.status).toBe(200)
      expect(startAnswer.parse(await answer?.json()).start).toEqual({ name: 'Ana', locale: 'es' })
    }

    const identity = (await mounted.sessions.identityOf(ANN))._unsafeUnwrap()

    await mounted.local.db.query(settingsLocaleStatement, { identity, locale: 'es' })

    const halfway = await mounted.route(signInRequest(ANN, NEW_PASSWORD, 'desk'), FROM)

    expect(startAnswer.parse(await halfway?.json()).start).toEqual({ name: 'Ana', locale: 'es' })

    await mounted.local.db.query(profileRowStatement, {
      id: profileIdFactory.create(),
      identity,
      name: 'Ana',
      email: ANN,
    })

    const started = await mounted.route(signInRequest(ANN, NEW_PASSWORD, 'desk'), FROM)

    expect(started?.status).toBe(200)
    expect(startAnswer.parse(await started?.json()).start).toBeUndefined()
  })

  it('leaves its email unverified when a step of the reset fails', async () => {
    const mounted = await mountedOnRealAuth()

    await annsLink(mounted.outbox)

    const identity =
      (await mounted.sessions.identityOf(ANN))._unsafeUnwrap() ?? expect.unreachable('Ann')
    const token = await resetLink(mounted)

    ;(await mounted.emailChanges.ask(identity, ANN, 'ann.new@example.test'))._unsafeUnwrap()
    await mounted.local.db.query(cancelRefuseStatement)

    expect((await mounted.route(reset(token), FROM))?.status).toBe(500)
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'laptop'), FROM))?.status).toBe(403)

    await mounted.local.db.query(cancelAllowStatement)
    expect((await mounted.route(reset(token), FROM))?.status).toBe(200)
    expect((await mounted.route(signInRequest(ANN, NEW_PASSWORD, 'laptop'), FROM))?.status).toBe(
      200,
    )
  })
})
