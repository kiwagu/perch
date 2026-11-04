import { describe, expect, it, vi } from 'vitest'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { deviceHeaders } from '../__fixtures__/auth-instance'
import pendingChangeStatement from '../__fixtures__/email-change-pending.surql'

import {
  ANN,
  ARGON2_WAIT,
  holdTurn,
  mountedOnRealAuth,
  PASSWORD,
  pastFloor,
  postTo,
  printedDuring,
  type Sender,
  type SignedInAccount,
  signedInOn,
  signInRequest,
  turnsAsked,
} from './__fixtures__/mount'
import { CHANGE_EMAIL_FLOOR_MS } from './email-change'
import { RESET_REQUEST_FLOOR_MS } from './password-reset'

/** The client address a request comes from, unless a test names another. */
const FROM = '203.0.113.7'

/** Another client address, which nothing from `FROM` charges. */
const ELSEWHERE = '203.0.113.8'

/** The new email most tests ask for: no part of it may reach the old address. */
const NEW_EMAIL = 'n3w-mailbox@elsewhere-domain.test'

/** An email that has an account of its own. */
const BOB = 'bob@example.test'

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** A change of the email to `email` from `sender`'s device, confirmed by `password`. */
const changeTo = (sender: Sender, email: string, password = PASSWORD) =>
  postTo('/auth/change-email', { email, password }, sender)

/** A confirmation with the link's `token`, from `sender` when one is named. */
const confirm = (token: string, sender?: Sender) => postTo('/auth/confirm-email', { token }, sender)

/** Asks to change `account`'s email to `email` from its laptop, past the floor. */
function asked(mounted: Mounted, account: SignedInAccount, email: string, from = FROM) {
  return pastFloor(
    mounted.clock,
    mounted.route(changeTo(account.on('laptop'), email), from),
    CHANGE_EMAIL_FLOOR_MS,
  )
}

/** Asks to change Ann's email to `email` and answers the token of the link mailed to it. */
async function confirmationLink(mounted: Mounted, ann: SignedInAccount, email = NEW_EMAIL) {
  const seen = mounted.outbox.to(email).length

  expect((await asked(mounted, ann, email))?.status).toBe(202)

  return linkToken(await mounted.outbox.next(email, seen))
}

/** An answer as a client sees it: its status, the names of its headers and its body. */
async function seen(answer: Response | undefined) {
  return {
    status: answer?.status,
    headers: [...(answer?.headers ?? [])].map(([name]) => name).sort(),
    body: (await answer?.text()) ?? '',
  }
}

describe('authHandler, the request to change the email', () => {
  it('answers a free and a taken new email alike, at the floor, and mails only the free one, linking to the confirmation screen', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const carl = await signedInOn(mounted, 'carl@example.test', ['laptop'])

    await signedInOn(mounted, BOB, ['desk'])

    let settled = 0
    const pending = [
      mounted.route(changeTo(ann.on('laptop'), NEW_EMAIL), FROM),
      mounted.route(changeTo(carl.on('laptop'), BOB.toUpperCase()), FROM),
    ].map((answer) =>
      answer.finally(() => {
        settled += 1
      }),
    )

    await vi.waitFor(() => expect(mounted.clock.pending()).toBe(2), ARGON2_WAIT)
    await mounted.clock.advance(CHANGE_EMAIL_FLOOR_MS - 1)
    expect(settled).toBe(0)
    await mounted.clock.advance(1)

    const [free, taken] = await Promise.all(pending)

    expect(await seen(free)).toEqual({ status: 202, headers: [], body: '' })
    expect(await seen(taken)).toEqual({ status: 202, headers: [], body: '' })

    const mail = await mounted.outbox.next(NEW_EMAIL)
    const link = new URL(/https?:\/\/\S+/.exec(mail.text)?.[0] ?? expect.unreachable('a link'))

    expect(mail.subject).toBe('Confirm your new email for Perch')
    expect(link.origin + link.pathname).toBe('http://localhost/confirm-email')
    // Bob's verification mail alone.
    expect(mounted.outbox.to(BOB)).toHaveLength(1)
    // The account keeps its email until the link is opened.
    expect((await mounted.sessions.identityOf(ANN))._unsafeUnwrap()).toBe(ann.identity)
  })

  it("answers the account's own email as a taken one, and mails nothing", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    expect((await asked(mounted, ann, ANN))?.status).toBe(202)
    expect(mounted.outbox.to(ANN)).toHaveLength(1)
  })

  it('refuses a wrong password with invalid-credentials, mailing nothing, and counts it as a failed sign-in', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const wrong = await mounted.route(changeTo(ann.on('laptop'), NEW_EMAIL, 'Wrong-pass-1'), FROM)

    expect(wrong?.status).toBe(400)
    expect(await wrong?.json()).toEqual({ code: 'invalid-credentials' })
    expect(mounted.outbox.to(NEW_EMAIL)).toEqual([])

    // Nine more failures, by sign-ins, spend the account's ten.
    for (let n = 0; n < 9; n += 1) {
      expect(
        (await mounted.route(signInRequest(ANN, 'Wrong-pass-1', 'desk'), ELSEWHERE))?.status,
      ).toBe(401)
    }

    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), ELSEWHERE))?.status).toBe(429)
  }, 30_000)

  it("refuses a new email that is not an email with email-invalid, taking none of the account's changes", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    for (const email of [
      'not an email',
      'ann@',
      '@example.test',
      '',
      '   ',
      `${'a'.repeat(310)}@example.test`,
    ]) {
      const refused = await mounted.route(changeTo(ann.on('laptop'), email), FROM)

      expect(refused?.status).toBe(400)
      expect(await refused?.json()).toEqual({ code: 'email-invalid' })
    }

    expect((await asked(mounted, ann, NEW_EMAIL))?.status).toBe(202)
  })

  it('takes three changes of an account within a quarter of an hour; the fourth answers rate-limited and mails nothing', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    for (let n = 0; n < 3; n += 1) {
      expect(
        (await asked(mounted, ann, `new-${n}@example.test`, n === 1 ? ELSEWHERE : FROM))?.status,
      ).toBe(202)
    }

    const fourth = await mounted.route(changeTo(ann.on('laptop'), 'new-3@example.test'), ELSEWHERE)

    expect(fourth?.status).toBe(429)
    expect(await fourth?.json()).toEqual({ code: 'rate-limited' })
    await mounted.outbox.next('new-2@example.test')
    expect(mounted.outbox.to('new-3@example.test')).toEqual([])
    await mounted.clock.advance(15 * MINUTE_MS)
    expect((await asked(mounted, ann, 'new-4@example.test'))?.status).toBe(202)
  }, 30_000)

  it('replaces an earlier request: only the newest link changes the email', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const first = await confirmationLink(mounted, ann, 'first@example.test')
    const second = await confirmationLink(mounted, ann, NEW_EMAIL)
    const refused = await mounted.route(confirm(first), FROM)

    expect(refused?.status).toBe(401)
    expect(await refused?.json()).toEqual({ code: 'link-invalid' })
    expect((await mounted.route(confirm(second), FROM))?.status).toBe(200)
  })

  it('refuses an empty password with invalid-credentials, mailing nothing', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const empty = await mounted.route(changeTo(ann.on('laptop'), NEW_EMAIL, ''), FROM)

    expect(empty?.status).toBe(400)
    expect(await empty?.json()).toEqual({ code: 'invalid-credentials' })
    expect(mounted.outbox.to(NEW_EMAIL)).toEqual([])
  })

  it('answers a request without a live session of its device 401', async () => {
    const mounted = await mountedOnRealAuth()
    const answer = await mounted.route(
      changeTo({ device: 'laptop', token: 'no-such-token' }, NEW_EMAIL),
      FROM,
    )

    expect(answer?.status).toBe(401)
  })
})

describe('authHandler, the confirmation of a new email', () => {
  it("makes the new email the account's, which signs it in from then on, and signs nothing in itself", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop', 'phone'])
    const token = await confirmationLink(mounted, ann)
    // Another browser, signed in to nobody, opens the link.
    const answer = await mounted.route(confirm(token, { device: 'kiosk' }), FROM)

    expect(answer?.status).toBe(200)
    expect(await answer?.json()).toEqual({ identity: ann.identity, email: NEW_EMAIL })
    expect(answer?.headers.get('set-auth-token')).toBeNull()
    expect((await mounted.sessions.identityOf(NEW_EMAIL))._unsafeUnwrap()).toBe(ann.identity)
    expect((await mounted.sessions.identityOf(ANN))._unsafeUnwrap()).toBeUndefined()
    // Every device of the account stays signed in, and reads the new email.
    for (const device of ['laptop', 'phone']) {
      const read = await mounted.sessions.read(ann.tokens.get(device) ?? '')

      expect(read.kind === 'session' ? read.caller.email : read.kind).toBe(NEW_EMAIL)
      expect(ann.sockets.get(device)?.ended).toEqual([])
    }

    expect(mounted.closes).toEqual([])
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(401)
    expect((await mounted.route(signInRequest(NEW_EMAIL, PASSWORD, 'desk'), FROM))?.status).toBe(
      200,
    )
  })

  it("tells the old address in the account's language, naming no part of the new email and carrying no link", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await confirmationLink(mounted, ann)

    await mounted.route(confirm(token), FROM)

    const notice = await mounted.outbox.next(ANN, 1)

    expect(notice.to).toBe(ANN)
    expect(notice.subject).toBe('Your Perch account has a new email')
    expect(notice.html).toContain('lang="en"')

    for (const part of [NEW_EMAIL, 'n3w-mailbox', 'elsewhere-domain', 'n3w', 'elsewhere']) {
      expect(`${notice.subject}\n${notice.text}\n${notice.html}`).not.toContain(part)
    }

    expect(notice.html).not.toContain('<a')
    expect(notice.text).not.toMatch(/https?:/)
    expect(mounted.outbox.to(NEW_EMAIL)).toHaveLength(1)
  })

  it("asks the account's profile to follow its new email once the email changed, and only then", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await confirmationLink(mounted, ann)

    expect((await mounted.route(confirm('not-a-token'), FROM))?.status).toBe(401)
    expect((await mounted.route(confirm(token), FROM))?.status).toBe(200)
    await vi.waitFor(() => expect(mounted.followed).toEqual([ann.identity]))
    expect((await mounted.route(confirm(token), FROM))?.status).toBe(401)
    expect(mounted.followed).toEqual([ann.identity])
  })

  it('answers link-invalid to a link opened again, changing nothing more', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await confirmationLink(mounted, ann)

    expect((await mounted.route(confirm(token), FROM))?.status).toBe(200)

    const again = await mounted.route(confirm(token), FROM)

    expect(again?.status).toBe(401)
    expect(await again?.json()).toEqual({ code: 'link-invalid' })
    // The verification mail, then one notice.
    await mounted.outbox.next(ANN, 1)
    expect(mounted.outbox.to(ANN)).toHaveLength(2)
  })

  it('changes the email once when one link is opened twice at once', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await confirmationLink(mounted, ann)
    const answers = await Promise.all([
      mounted.route(confirm(token), FROM),
      mounted.route(confirm(token), FROM),
    ])

    expect(answers.map((answer) => answer?.status).sort()).toEqual([200, 401])
  })

  it('answers link-expired to a link a day old, and changes nothing', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await confirmationLink(mounted, ann)

    await mounted.clock.advance(DAY_MS - CHANGE_EMAIL_FLOOR_MS - 1)
    expect((await mounted.emailChanges.read(token))._unsafeUnwrap().kind).toBe('change')
    await mounted.clock.advance(1)

    const expired = await mounted.route(confirm(token), FROM)

    expect(expired?.status).toBe(401)
    expect(await expired?.json()).toEqual({ code: 'link-expired' })
    expect((await mounted.sessions.identityOf(ANN))._unsafeUnwrap()).toBe(ann.identity)
  })

  it('answers link-invalid once the account changed its password since the mail was sent', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await confirmationLink(mounted, ann)
    const changed = await mounted.route(
      postTo(
        '/auth/change-password',
        { currentPassword: PASSWORD, password: 'New-pass-word-2' },
        ann.on('laptop'),
      ),
      FROM,
    )

    expect(changed?.status).toBe(204)

    const refused = await mounted.route(confirm(token), FROM)

    expect(refused?.status).toBe(401)
    expect(await refused?.json()).toEqual({ code: 'link-invalid' })
    expect((await mounted.sessions.identityOf(ANN))._unsafeUnwrap()).toBe(ann.identity)
  })

  it('answers link-invalid once the account changed its email since the mail was sent', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await confirmationLink(mounted, ann)

    expect(
      (await mounted.emailChanges.move(ann.identity, ANN, 'moved@example.test'))._unsafeUnwrap(),
    ).toBe(true)

    const refused = await mounted.route(confirm(token), FROM)

    expect(refused?.status).toBe(401)
    expect(await refused?.json()).toEqual({ code: 'link-invalid' })
    expect((await mounted.sessions.identityOf('moved@example.test'))._unsafeUnwrap()).toBe(
      ann.identity,
    )
  })

  it('answers link-invalid once the new email has got an account meanwhile', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await confirmationLink(mounted, ann)

    await mounted.auth.api.signUpEmail({
      body: { name: 'Nina', email: NEW_EMAIL, password: PASSWORD },
      headers: deviceHeaders('desk'),
    })

    const refused = await mounted.route(confirm(token), FROM)

    expect(refused?.status).toBe(401)
    expect(await refused?.json()).toEqual({ code: 'link-invalid' })
    expect((await mounted.sessions.identityOf(ANN))._unsafeUnwrap()).toBe(ann.identity)
  })

  it("answers link-invalid to a token the gateway did not sign as a confirmation, a verification link's among them", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await confirmationLink(mounted, ann)
    const verification = linkToken(mounted.outbox.to(ANN)[0] ?? expect.unreachable('a mail'))
    const [header, payload] = token.split('.')

    for (const forged of ['not-a-token', verification, `${header}.${payload}.c2lnbmF0dXJl`]) {
      const refused = await mounted.route(confirm(forged), FROM)

      expect(refused?.status).toBe(401)
      expect(await refused?.json()).toEqual({ code: 'link-invalid' })
    }

    // Nor does Better Auth's verification take a confirmation's token for one of its own.
    const crossed = await mounted.route(
      postTo('/auth/verify-email', { token }, { device: 'kiosk' }),
      ELSEWHERE,
    )

    expect(crossed?.status).toBe(401)
    expect((await mounted.sessions.identityOf(ANN))._unsafeUnwrap()).toBe(ann.identity)
  })

  it('takes twenty attempts of an address within ten minutes, and answers the next rate-limited', async () => {
    const mounted = await mountedOnRealAuth()

    for (let n = 0; n < 20; n += 1) {
      expect((await mounted.route(confirm(`not-a-token-${n}`), FROM))?.status).toBe(401)
    }

    const limited = await mounted.route(confirm('not-a-token'), FROM)

    expect(limited?.status).toBe(429)
    expect(await limited?.json()).toEqual({ code: 'rate-limited' })
    expect((await mounted.route(confirm('not-a-token'), ELSEWHERE))?.status).toBe(401)
    await mounted.clock.advance(10 * MINUTE_MS)
    expect((await mounted.route(confirm('not-a-token'), FROM))?.status).toBe(401)
  })

  it('logs, prints and answers nothing of the emails, the token or the password', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const { result: token, printed } = await printedDuring(async () => {
      await mounted.route(changeTo(ann.on('laptop'), NEW_EMAIL, 'Wrong-pass-1'), FROM)

      const link = await confirmationLink(mounted, ann)

      await mounted.route(confirm(link), FROM)
      await mounted.route(confirm(link), FROM)

      return link
    })
    const told = `${printed}\n${JSON.stringify(mounted.logs)}`

    for (const secret of [ANN, NEW_EMAIL, token, PASSWORD, 'Wrong-pass-1']) {
      expect(told).not.toContain(secret)
    }
  })
})

describe('authHandler, a change of the email and what runs beside it', () => {
  it('creates no link for a change of the email that waited while a reset ended its session', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    await pastFloor(
      mounted.clock,
      mounted.route(postTo('/auth/request-password-reset', { email: ANN }), FROM),
      RESET_REQUEST_FLOOR_MS,
    )

    const link = linkToken(await mounted.outbox.next(ANN, 1))
    const asked = turnsAsked(mounted.turns)
    const release = await holdTurn(mounted.turns, ann.identity)
    const resetting = mounted.route(
      postTo('/auth/reset-password', { token: link, password: 'New-pass-word-2' }),
      FROM,
    )

    await vi.waitFor(() => expect(asked(ann.identity)).toBe(2), ARGON2_WAIT)

    const changing = mounted.route(changeTo(ann.on('laptop'), NEW_EMAIL), FROM)

    await vi.waitFor(() => expect(asked(ann.identity)).toBe(3), ARGON2_WAIT)
    release()
    expect((await resetting)?.status).toBe(204)

    const changed = await changing

    expect(changed?.status).toBe(401)
    expect(await changed?.json()).toEqual({ code: 'unauthorized' })

    const [pending] = await mounted.local.db.query<[unknown[]]>(pendingChangeStatement, {
      identity: ann.identity,
    })

    expect(pending).toEqual([])
    expect(mounted.outbox.to(NEW_EMAIL)).toEqual([])
  }, 30_000)

  it('answers link-expired to a link that expired while the confirmation waited for the account', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await confirmationLink(mounted, ann)
    const asked = turnsAsked(mounted.turns)
    const release = await holdTurn(mounted.turns, ann.identity)
    const confirming = mounted.route(confirm(token), FROM)

    await vi.waitFor(() => expect(asked(ann.identity)).toBe(2))
    await mounted.clock.advance(DAY_MS)
    release()

    const expired = await confirming

    expect(expired?.status).toBe(401)
    expect(await expired?.json()).toEqual({ code: 'link-expired' })
    expect((await mounted.sessions.identityOf(ANN))._unsafeUnwrap()).toBe(ann.identity)
  })
})

describe('authHandler, a confirmation and the reset links of the account', () => {
  it('ends every reset link of the account: one mailed to the old email before the confirmation answers link-invalid after it', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    await pastFloor(
      mounted.clock,
      mounted.route(postTo('/auth/request-password-reset', { email: ANN }), FROM),
      RESET_REQUEST_FLOOR_MS,
    )

    const link = linkToken(await mounted.outbox.next(ANN, 1))
    const token = await confirmationLink(mounted, ann)

    expect((await mounted.route(confirm(token), FROM))?.status).toBe(200)

    const refused = await mounted.route(
      postTo('/auth/reset-password', { token: link, password: 'New-pass-word-2' }),
      FROM,
    )

    expect(refused?.status).toBe(401)
    expect(await refused?.json()).toEqual({ code: 'link-invalid' })
    expect((await mounted.route(signInRequest(NEW_EMAIL, PASSWORD, 'desk'), FROM))?.status).toBe(
      200,
    )
  })
})
