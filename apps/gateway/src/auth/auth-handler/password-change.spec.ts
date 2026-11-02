import { describe, expect, it, vi } from 'vitest'

import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { linkToken } from '../../mail/__fixtures__/outbox'
import cancelAllowStatement from '../__fixtures__/email-change-cancel-allow.surql'
import cancelRefuseStatement from '../__fixtures__/email-change-cancel-refuse.surql'
import pendingChangeStatement from '../__fixtures__/email-change-pending.surql'

import {
  ANN,
  ARGON2_WAIT,
  heldQueries,
  isSessionInsert,
  mountedOnRealAuth,
  PASSWORD,
  pastFloor,
  postTo,
  printedDuring,
  type Sender,
  signedInOn,
  signInRequest,
  turnsAsked,
} from './__fixtures__/mount'
import { RESET_REQUEST_FLOOR_MS } from './password-reset'

/** The client address a request comes from, unless a test names another. */
const FROM = '203.0.113.7'

/** How long a test of many password checks may run: each is an argon2 run, slow on a busy host. */
const ARGON2_RUNS_MS = 30_000

/** The new password most tests set, which keeps the rules of a new password. */
const NEW_PASSWORD = 'New-pass-word-2'

/** A change of the password from `sender`'s device, with its session token. */
const change = (sender: Sender, currentPassword: string, password = NEW_PASSWORD) =>
  postTo('/auth/change-password', { currentPassword, password }, sender)

describe('authHandler, the change of a password', () => {
  it('sets the new password, keeps this device signed in and signs every other device out, closing their sockets with 4002', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop', 'phone', 'tablet'])
    const answer = await mounted.route(change(ann.on('laptop'), PASSWORD), FROM)

    expect(answer?.status).toBe(204)
    expect(await answer?.text()).toBe('')
    expect((await mounted.sessions.read(ann.tokens.get('laptop') ?? '')).kind).toBe('session')
    expect(ann.sockets.get('laptop')?.ended).toEqual([])

    for (const device of ['phone', 'tablet']) {
      expect(await mounted.sessions.read(ann.tokens.get(device) ?? '')).toEqual({ kind: 'none' })
      expect(ann.sockets.get(device)?.ended).toEqual([CLOSE.passwordChanged])
    }

    expect([...mounted.closes].sort()).toEqual([
      [ann.identity, 'phone', CLOSE.passwordChanged],
      [ann.identity, 'tablet', CLOSE.passwordChanged],
    ])
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM))?.status).toBe(401)
    expect((await mounted.route(signInRequest(ANN, NEW_PASSWORD, 'phone'), FROM))?.status).toBe(200)
  })

  it('ends every reset link of the account and mails the notice of a changed password', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    await pastFloor(
      mounted.clock,
      mounted.route(postTo('/auth/request-password-reset', { email: ANN }), FROM),
      RESET_REQUEST_FLOOR_MS,
    )

    const link = linkToken(await mounted.outbox.next(ANN, 1))

    expect((await mounted.route(change(ann.on('laptop'), PASSWORD), FROM))?.status).toBe(204)
    expect((await mounted.resets.read(link))._unsafeUnwrap()).toBeUndefined()

    const notice = await mounted.outbox.next(ANN, 2)

    expect(notice.subject).toBe('Your Perch password was changed')
    expect(notice.text).toContain('http://localhost/forgot-password')
  })

  it(
    'refuses a wrong current password with invalid-credentials, changing nothing, and counts it as a failed sign-in',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop', 'phone'])

      for (let n = 0; n < 10; n += 1) {
        const wrong = await mounted.route(change(ann.on('laptop'), 'Wrong-pass-1'), FROM)

        expect(wrong?.status).toBe(400)
        expect(await wrong?.json()).toEqual({ code: 'invalid-credentials' })
      }

      // The account's ten failed sign-ins are spent: the right password and a sign-in wait too.
      const limited = await mounted.route(change(ann.on('laptop'), PASSWORD), FROM)

      expect(limited?.status).toBe(429)
      expect(await limited?.json()).toEqual({ code: 'rate-limited' })
      expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(429)
      expect((await mounted.sessions.read(ann.tokens.get('phone') ?? '')).kind).toBe('session')
      expect(ann.sockets.get('phone')?.ended).toEqual([])
      await mounted.clock.advance(15 * 60 * 1000)
      expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(200)
    },
    ARGON2_RUNS_MS,
  )

  it('refuses a new password that breaks the rules with password-rejected, counting nothing', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const weak = await mounted.route(change(ann.on('laptop'), PASSWORD, 'abcdefghij'), FROM)

    expect(weak?.status).toBe(400)
    expect(await weak?.json()).toEqual({ code: 'password-rejected' })
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'laptop'), FROM))?.status).toBe(200)
  })

  it('answers a request without a live session of its device 401, and one that names no device 400', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const laptopToken = ann.tokens.get('laptop') ?? ''
    const unknown = await mounted.route(
      change({ device: 'laptop', token: 'no-such-token' }, PASSWORD),
      FROM,
    )

    expect(unknown?.status).toBe(401)
    expect(unknown?.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(
      (await mounted.route(change({ device: 'phone', token: laptopToken }, PASSWORD), FROM))
        ?.status,
    ).toBe(401)
    expect(
      (
        await mounted.route(
          postTo('/auth/change-password', { currentPassword: PASSWORD, password: NEW_PASSWORD }),
          FROM,
        )
      )?.status,
    ).toBe(400)
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'laptop'), FROM))?.status).toBe(200)
  })

  it('logs, prints and answers nothing of the passwords or the token', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = ann.tokens.get('laptop') ?? ''
    const { printed } = await printedDuring(async () => {
      await mounted.route(change(ann.on('laptop'), 'Wrong-pass-1'), FROM)
      await mounted.route(change(ann.on('laptop'), PASSWORD, 'abcdefghij'), FROM)
      await mounted.route(change(ann.on('laptop'), PASSWORD), FROM)
    })
    const told = `${printed}\n${JSON.stringify(mounted.logs)}`

    for (const secret of [ANN, token, PASSWORD, NEW_PASSWORD, 'Wrong-pass-1', 'abcdefghij']) {
      expect(told).not.toContain(secret)
    }
  })
})

/** What a sign-in answers, as far as these tests read it. */
const signedInAnswer = z.object({ token: z.string().min(1) })

describe('authHandler, a change of a password and what runs beside it', () => {
  it(
    'leaves no working session to a sign-in with the old password that checked it before the change',
    async () => {
      const queries = heldQueries()
      const mounted = await mountedOnRealAuth({ directory: queries.directory })
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const asked = turnsAsked(mounted.turns)

      const hold = queries.hold(isSessionInsert)

      const signingIn = mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM)

      await vi.waitFor(() => expect(hold.paused()).toBe(true), ARGON2_WAIT)

      let changed = false
      const changing = mounted.route(change(ann.on('laptop'), PASSWORD), FROM).finally(() => {
        changed = true
      })

      await vi.waitFor(() => expect(changed || asked(ann.identity) >= 2).toBe(true), ARGON2_WAIT)
      hold.release()

      const [signedIn, answered] = await Promise.all([signingIn, changing])

      expect(answered?.status).toBe(204)

      if (signedIn?.status === 200) {
        const { token: phone } = signedInAnswer.parse(await signedIn.json())

        expect(await mounted.sessions.read(phone)).toEqual({ kind: 'none' })
      }

      expect((await mounted.sessions.read(ann.tokens.get('laptop') ?? '')).kind).toBe('session')
    },
    ARGON2_RUNS_MS,
  )

  it(
    'leaves the password, the sessions and the links as they were when a step of the change fails',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop', 'phone'])

      await pastFloor(
        mounted.clock,
        mounted.route(postTo('/auth/request-password-reset', { email: ANN }), FROM),
        RESET_REQUEST_FLOOR_MS,
      )

      const link = linkToken(await mounted.outbox.next(ANN, 1))

      ;(await mounted.emailChanges.ask(ann.identity, ANN, 'ann.new@example.test'))._unsafeUnwrap()
      await mounted.local.db.query(cancelRefuseStatement)

      const failed = await mounted.route(change(ann.on('laptop'), PASSWORD), FROM)
      const [pending] = await mounted.local.db.query<[unknown[]]>(pendingChangeStatement, {
        identity: ann.identity,
      })

      expect(failed?.status).toBe(500)
      expect((await mounted.sessions.read(ann.tokens.get('phone') ?? '')).kind).toBe('session')
      expect(ann.sockets.get('phone')?.ended).toEqual([])
      expect(mounted.closes).toEqual([])
      expect((await mounted.resets.read(link))._unsafeUnwrap()).toBeDefined()
      expect(pending).toHaveLength(1)
      expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(200)

      await mounted.local.db.query(cancelAllowStatement)
      expect((await mounted.route(change(ann.on('laptop'), PASSWORD), FROM))?.status).toBe(204)
    },
    ARGON2_RUNS_MS,
  )
})
