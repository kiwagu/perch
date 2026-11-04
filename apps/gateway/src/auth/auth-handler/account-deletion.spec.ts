import type { ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { CLOSE } from '@workspace/replica/protocol'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { deviceHeaders, signUpOn } from '../__fixtures__/auth-instance'

import {
  ANN,
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
  signUpRequest,
  turnsAsked,
} from './__fixtures__/mount'
import { SIGN_UP_FLOOR_MS } from './sign-up'

/** The client address a request comes from, unless a test names another. */
const FROM = '203.0.113.7'

/** Another client address, which nothing from `FROM` charges. */
const ELSEWHERE = '203.0.113.8'

/** An account of its own, which a test makes a member of Ann's organisation. */
const BOB = 'bob@example.test'

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** A request to delete the account from `sender`'s device, confirmed by `password`. */
const askToDelete = (sender: Sender, password = PASSWORD) =>
  postTo('/auth/request-account-deletion', { password }, sender)

/** A press of the deletion page's button with the link's `token`, from `sender` when one is named. */
const press = (token: string, sender?: Sender) => postTo('/auth/delete-account', { token }, sender)

/** Asks to delete `account`'s account from its laptop and answers the token of the link mailed to it. */
async function deletionLink(mounted: Mounted, account: Sender, email = ANN): Promise<string> {
  const seen = mounted.outbox.to(email).length

  expect((await mounted.route(askToDelete(account), FROM))?.status).toBe(202)

  return linkToken(await mounted.outbox.next(email, seen))
}

/** What a command a test starts from answers; one that fails fails the test. */
async function done<T, E>(command: ResultAsync<T, E>): Promise<T> {
  return (await command)._unsafeUnwrap()
}

/** Whether `account`'s identity still signs in with its email. */
async function stillThere(mounted: Mounted, account: SignedInAccount, email = ANN) {
  return (await mounted.sessions.identityOf(email))._unsafeUnwrap() === account.identity
}

describe('authHandler, the request to delete the account', () => {
  it("mails the link to the account's own email, linking to the deletion screen, and answers 202 with no body, the account staying as it is", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const answer = await mounted.route(askToDelete(ann.on('laptop')), FROM)

    expect(answer?.status).toBe(202)
    expect(await answer?.text()).toBe('')

    const mail = await mounted.outbox.next(ANN, 1)
    const link = new URL(/https?:\/\/\S+/.exec(mail.text)?.[0] ?? expect.unreachable('a link'))

    expect(mail.to).toBe(ANN)
    expect(mail.subject).toBe('Delete your Perch account')
    expect(link.origin + link.pathname).toBe('http://localhost/delete-account')
    expect(link.searchParams.get('token')).toBeTruthy()
    expect(await stillThere(mounted, ann)).toBe(true)
    expect((await mounted.sessions.read(ann.tokens.get('laptop') ?? '')).kind).toBe('session')
    expect(mounted.closes).toEqual([])
  })

  it('refuses a wrong password with invalid-credentials, mailing nothing, and counts it as a failed sign-in', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    for (const password of ['Wrong-pass-1', '']) {
      const wrong = await mounted.route(askToDelete(ann.on('laptop'), password), FROM)

      expect(wrong?.status).toBe(400)
      expect(await wrong?.json()).toEqual({ code: 'invalid-credentials' })
    }

    expect(mounted.outbox.to(ANN)).toHaveLength(1)

    // Eight more failures, by sign-ins, spend the account's ten.
    for (let n = 0; n < 8; n += 1) {
      expect(
        (await mounted.route(signInRequest(ANN, 'Wrong-pass-1', 'desk'), ELSEWHERE))?.status,
      ).toBe(401)
    }

    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), ELSEWHERE))?.status).toBe(429)
  }, 30_000)

  it('answers a body that names no password bad-request', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const answer = await mounted.route(
      postTo('/auth/request-account-deletion', {}, ann.on('laptop')),
      FROM,
    )

    expect(answer?.status).toBe(400)
    expect(await answer?.json()).toEqual({ code: 'bad-request' })
  })

  it('answers last-admin to the only admin of an organisation with other members, mailing nothing, until they are removed', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const bob = await signedInOn(mounted, BOB, ['desk'])

    await done(mounted.organisations.create({ identity: ann.identity, key: 'acme', name: 'Acme' }))
    await done(mounted.organisations.invite({ actor: ann.identity, key: 'acme', email: BOB }))

    const refused = await mounted.route(askToDelete(ann.on('laptop')), FROM)

    expect(refused?.status).toBe(409)
    expect(await refused?.json()).toEqual({ code: 'last-admin' })
    expect(mounted.outbox.to(ANN)).toHaveLength(1)

    await done(
      mounted.organisations.remove({ actor: ann.identity, key: 'acme', identity: bob.identity }),
    )

    expect((await mounted.route(askToDelete(ann.on('laptop')), FROM))?.status).toBe(202)
    await mounted.outbox.next(ANN, 1)
  })

  it('takes three requests of an account within a quarter of an hour; the fourth answers rate-limited and mails nothing', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    for (let n = 0; n < 3; n += 1) {
      expect(
        (await mounted.route(askToDelete(ann.on('laptop')), n === 1 ? ELSEWHERE : FROM))?.status,
      ).toBe(202)
    }

    await mounted.outbox.next(ANN, 3)

    const fourth = await mounted.route(askToDelete(ann.on('laptop')), ELSEWHERE)

    expect(fourth?.status).toBe(429)
    expect(await fourth?.json()).toEqual({ code: 'rate-limited' })
    expect(fourth?.headers.get('retry-after')).toBeTruthy()
    expect(mounted.outbox.to(ANN)).toHaveLength(4)
    await mounted.clock.advance(15 * MINUTE_MS)
    expect((await mounted.route(askToDelete(ann.on('laptop')), FROM))?.status).toBe(202)
  }, 30_000)

  it('replaces an earlier request: only the newest link deletes the account', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const first = await deletionLink(mounted, ann.on('laptop'))
    const second = await deletionLink(mounted, ann.on('laptop'))
    const refused = await mounted.route(press(first), FROM)

    expect(refused?.status).toBe(401)
    expect(await refused?.json()).toEqual({ code: 'link-invalid' })
    expect(await stillThere(mounted, ann)).toBe(true)
    expect((await mounted.route(press(second), FROM))?.status).toBe(200)
  })

  it('answers a request without a live session of its device 401', async () => {
    const mounted = await mountedOnRealAuth()
    const answer = await mounted.route(
      askToDelete({ device: 'laptop', token: 'no-such-token' }),
      FROM,
    )

    expect(answer?.status).toBe(401)
    expect(mounted.outbox.sent).toEqual([])
  })
})

describe('authHandler, the deletion of an account by its link', () => {
  it('ends every session and closes every socket with 4001 before the rows go, then deletes the account, whose email signs up again; answers 200 with the identity', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop', 'phone'])
    const token = await deletionLink(mounted, ann.on('laptop'))

    mounted.steps.splice(0)

    // Another browser, signed in to nobody, opens the link.
    const answer = await mounted.route(press(token, { device: 'kiosk' }), FROM)

    expect(answer?.status).toBe(200)
    expect(await answer?.json()).toEqual({ identity: ann.identity })
    expect(mounted.steps).toEqual([
      'sessions ended',
      `sockets closed ${CLOSE.revoked}`,
      'departure',
      'rows removed',
    ])
    expect(mounted.closes).toEqual([[ann.identity, undefined, CLOSE.revoked]])

    for (const device of ['laptop', 'phone']) {
      expect(ann.sockets.get(device)?.ended).toEqual([CLOSE.revoked])
      expect((await mounted.sessions.read(ann.tokens.get(device) ?? '')).kind).toBe('none')
    }

    expect((await mounted.sessions.identityOf(ANN))._unsafeUnwrap()).toBeUndefined()
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(401)
    expect(
      (
        await pastFloor(
          mounted.clock,
          mounted.route(signUpRequest(ANN), ELSEWHERE),
          SIGN_UP_FLOOR_MS,
        )
      )?.status,
    ).toBe(202)
    // The new account's verification mail, after the old one's three mails.
    await mounted.outbox.next(ANN, 3)
  }, 30_000)

  it('tells the email the account had, in its language, naming nothing else and carrying no link', async () => {
    const mounted = await mountedOnRealAuth()
    const signedUp = await signUpOn(mounted.auth, ANN, deviceHeaders('laptop'), { locale: 'es' })
    const token = await deletionLink(mounted, { device: 'laptop', token: signedUp.token })

    expect((await mounted.route(press(token), FROM))?.status).toBe(200)

    const notice = await mounted.outbox.next(ANN, 2)

    expect(notice.to).toBe(ANN)
    expect(notice.subject).toBe('Tu cuenta de Perch fue eliminada')
    expect(notice.html).toContain('lang="es"')
    expect(notice.html).not.toContain('<a')
    expect(notice.text).not.toMatch(/https?:/)
  })

  it('takes the account out of its organisations: one it alone belongs to goes whole, another keeps its other members', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const bob = await signedInOn(mounted, BOB, ['desk'])
    const { organisations } = mounted

    await done(organisations.create({ identity: ann.identity, key: 'solo', name: 'Solo' }))
    await done(organisations.create({ identity: bob.identity, key: 'shared', name: 'Shared' }))
    await done(organisations.invite({ actor: bob.identity, key: 'shared', email: ANN }))

    const token = await deletionLink(mounted, ann.on('laptop'))

    expect((await mounted.route(press(token), FROM))?.status).toBe(200)
    expect((await organisations.membershipsOf(ann.identity))._unsafeUnwrap()).toEqual([])
    expect(
      (await organisations.membersOf({ actor: bob.identity, key: 'shared' }))
        ._unsafeUnwrap()
        .map((member) => member.identity.email),
    ).toEqual([BOB])
    // The organisation Ann alone belonged to went, so its key is free again.
    expect(
      (await organisations.create({ identity: bob.identity, key: 'solo', name: 'Solo' })).isOk(),
    ).toBe(true)
  })

  it('answers link-invalid to the same link pressed again, deleting nothing more', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await deletionLink(mounted, ann.on('laptop'))

    expect((await mounted.route(press(token), FROM))?.status).toBe(200)
    await mounted.outbox.next(ANN, 2)

    const again = await mounted.route(press(token), FROM)

    expect(again?.status).toBe(401)
    expect(await again?.json()).toEqual({ code: 'link-invalid' })
    // The verification mail, the deletion mail, then one notice.
    expect(mounted.outbox.to(ANN)).toHaveLength(3)
  })

  it('deletes the account once when one link is pressed twice at once', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await deletionLink(mounted, ann.on('laptop'))
    const answers = await Promise.all([
      mounted.route(press(token), FROM),
      mounted.route(press(token), FROM),
    ])

    expect(answers.map((answer) => answer?.status).sort()).toEqual([200, 401])
    await mounted.outbox.next(ANN, 2)
    expect(mounted.outbox.to(ANN)).toHaveLength(3)
  })

  it('answers link-expired to a link an hour old, and deletes nothing', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await deletionLink(mounted, ann.on('laptop'))

    await mounted.clock.advance(HOUR_MS - 1)
    expect((await mounted.accountDeletions.read(token))._unsafeUnwrap().kind).toBe('deletion')
    await mounted.clock.advance(1)

    const expired = await mounted.route(press(token), FROM)

    expect(expired?.status).toBe(401)
    expect(await expired?.json()).toEqual({ code: 'link-expired' })
    expect(await stillThere(mounted, ann)).toBe(true)
  })

  it('answers link-invalid once the account changed its password since the mail was sent', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await deletionLink(mounted, ann.on('laptop'))
    const changed = await mounted.route(
      postTo(
        '/auth/change-password',
        { currentPassword: PASSWORD, password: 'New-pass-word-2' },
        ann.on('laptop'),
      ),
      FROM,
    )

    expect(changed?.status).toBe(204)

    const refused = await mounted.route(press(token), FROM)

    expect(refused?.status).toBe(401)
    expect(await refused?.json()).toEqual({ code: 'link-invalid' })
    expect(await stillThere(mounted, ann)).toBe(true)
  })

  it('answers last-admin to a press while the account is the only admin of an organisation with others, deleting nothing and keeping the link, which deletes once they are gone', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const bob = await signedInOn(mounted, BOB, ['desk'])

    await done(mounted.organisations.create({ identity: ann.identity, key: 'acme', name: 'Acme' }))

    const token = await deletionLink(mounted, ann.on('laptop'))

    await done(mounted.organisations.invite({ actor: ann.identity, key: 'acme', email: BOB }))

    const refused = await mounted.route(press(token), FROM)

    expect(refused?.status).toBe(409)
    expect(await refused?.json()).toEqual({ code: 'last-admin' })
    expect(await stillThere(mounted, ann)).toBe(true)
    expect((await mounted.sessions.read(ann.tokens.get('laptop') ?? '')).kind).toBe('session')
    expect(mounted.closes).toEqual([])
    expect(mounted.outbox.to(ANN)).toHaveLength(2)

    await done(
      mounted.organisations.remove({ actor: ann.identity, key: 'acme', identity: bob.identity }),
    )

    expect((await mounted.route(press(token), FROM))?.status).toBe(200)
    expect((await mounted.sessions.identityOf(ANN))._unsafeUnwrap()).toBeUndefined()
  })

  it("answers link-invalid to a token the gateway did not sign as a deletion, a verification link's among them", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await deletionLink(mounted, ann.on('laptop'))
    const verification = linkToken(mounted.outbox.to(ANN)[0] ?? expect.unreachable('a mail'))
    const [header, payload] = token.split('.')

    for (const forged of ['not-a-token', verification, `${header}.${payload}.c2lnbmF0dXJl`]) {
      const refused = await mounted.route(press(forged), FROM)

      expect(refused?.status).toBe(401)
      expect(await refused?.json()).toEqual({ code: 'link-invalid' })
    }

    // Nor does the confirmation of a new email take a deletion's token for one of its own.
    const crossed = await mounted.route(postTo('/auth/confirm-email', { token }), ELSEWHERE)

    expect(crossed?.status).toBe(401)
    expect(await stillThere(mounted, ann)).toBe(true)
  })

  it('answers a body that names no token bad-request', async () => {
    const mounted = await mountedOnRealAuth()

    for (const body of [{}, { token: '' }, { token: 7 }]) {
      const answer = await mounted.route(postTo('/auth/delete-account', body), FROM)

      expect(answer?.status).toBe(400)
      expect(await answer?.json()).toEqual({ code: 'bad-request' })
    }
  })

  it('takes twenty attempts of an address within ten minutes, and answers the next rate-limited', async () => {
    const mounted = await mountedOnRealAuth()

    for (let n = 0; n < 20; n += 1) {
      expect((await mounted.route(press(`not-a-token-${n}`), FROM))?.status).toBe(401)
    }

    const limited = await mounted.route(press('not-a-token'), FROM)

    expect(limited?.status).toBe(429)
    expect(await limited?.json()).toEqual({ code: 'rate-limited' })
    // The confirmations of a new email count on their own.
    expect((await mounted.route(postTo('/auth/confirm-email', { token: 'x' }), FROM))?.status).toBe(
      401,
    )
    expect((await mounted.route(press('not-a-token'), ELSEWHERE))?.status).toBe(401)
    await mounted.clock.advance(10 * MINUTE_MS)
    expect((await mounted.route(press('not-a-token'), FROM))?.status).toBe(401)
  })

  it('answers link-expired to a link that expired while the deletion waited for the account', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await deletionLink(mounted, ann.on('laptop'))
    const asked = turnsAsked(mounted.turns)
    const release = await holdTurn(mounted.turns, ann.identity)
    const pressing = mounted.route(press(token), FROM)

    await vi.waitFor(() => expect(asked(ann.identity)).toBe(2))
    await mounted.clock.advance(HOUR_MS)
    release()

    const expired = await pressing

    expect(expired?.status).toBe(401)
    expect(await expired?.json()).toEqual({ code: 'link-expired' })
    expect(await stillThere(mounted, ann)).toBe(true)
  })

  it("leaves Better Auth's own deletion of a user out of reach: 404, the account staying", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    for (const method of ['GET', 'POST']) {
      const answer = await mounted.route(
        new Request('http://gateway.test/auth/delete-user', {
          method,
          headers: { authorization: `Bearer ${ann.tokens.get('laptop') ?? ''}` },
        }),
        FROM,
      )

      expect(answer?.status).toBe(404)
      expect(await answer?.json()).toEqual({ code: 'not-found' })
    }

    expect(await stillThere(mounted, ann)).toBe(true)
  })

  it('logs, prints and answers nothing of the email, the token or the password', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const { result: token, printed } = await printedDuring(async () => {
      await mounted.route(askToDelete(ann.on('laptop'), 'Wrong-pass-1'), FROM)

      const link = await deletionLink(mounted, ann.on('laptop'))

      await mounted.route(press(link), FROM)
      await mounted.route(press(link), FROM)

      return link
    })
    const told = `${printed}\n${JSON.stringify(mounted.logs)}`

    for (const secret of [ANN, token, PASSWORD, 'Wrong-pass-1']) {
      expect(told).not.toContain(secret)
    }
  })
})
