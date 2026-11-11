import { describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import { z } from '@workspace/zod'

import { deviceHeaders, signUpOn } from '../../auth/__fixtures__/auth-instance'
import {
  holdTurn,
  PASSWORD,
  postTo,
  signedInOn,
  turnsAsked,
  verifyRequest,
} from '../../auth/auth-handler/__fixtures__/mount'
import { linkToken } from '../../mail/__fixtures__/outbox'
import { type ConsoleMount, consoleOnMount, OPERATOR_ADDRESS } from '../__fixtures__/console-mount'

/** The account the operator acts on. */
const BOB = 'bob@example.test'

/** What a verification that signs a device in answers. */
const signedInAnswer = z.object({ token: z.string().min(1), user: z.object({ id: z.string() }) })

/** The email an operator moves bob's account to. */
const NEW_EMAIL = 'robert@elsewhere.test'

/** Another client address, which nothing the operator asks charges. */
const ELSEWHERE = '203.0.113.20'

/** The subjects of the reset mail and of the verification mail, in each language. */
const RESET_SUBJECT = {
  en: 'Set a new password for Perch',
  es: 'Elige una contraseña nueva para Perch',
}
const VERIFY_SUBJECT = 'Confirm your email for Perch'

/** The mails to `email` whose subject is `subject`. */
const mailsTitled = (mounted: ConsoleMount, email: string, subject: string) =>
  mounted.outbox.to(email).filter((mail) => mail.subject === subject)

/** Bob signed up and never opened his link: his email is not verified, and he holds no session. */
async function unverifiedBob(mounted: ConsoleMount) {
  await mounted.auth.api.signUpEmail({
    body: { name: 'Bob', email: BOB, password: PASSWORD, locale: 'en' },
    headers: deviceHeaders('tablet'),
  })
  // His sign-up's own mail.
  await mounted.outbox.next(BOB)

  return mounted.identityOf(BOB)
}

describe('consoleRoutes: POST /console/accounts/:id/reset', () => {
  it("sends the account's email its reset link, in the account's language, which sets a new password", async () => {
    const mounted = await consoleOnMount()
    const { user } = await signUpOn(mounted.auth, BOB, deviceHeaders('desk'), { locale: 'es' })
    const bob = await mounted.identityOf(user.email)

    expect(await mounted.act(bob, 'reset')).toEqual({
      status: 204,
      body: undefined,
      retryAfter: null,
    })

    const mail = await mounted.outbox.next(BOB, 1)
    const link = new URL(/https?:\/\/\S+/.exec(mail.text)?.[0] ?? expect.unreachable('a link'))

    expect(mail.subject).toBe(RESET_SUBJECT.es)
    expect(link.origin + link.pathname).toBe('http://localhost/reset-password')
    expect(
      (
        await mounted.route(
          postTo('/auth/reset-password', { token: linkToken(mail), password: 'New-pass-word-2' }),
          ELSEWHERE,
        )
      )?.status,
    ).toBe(200)
    expect(mounted.consoleFailures).toEqual([])
  })

  it('takes three reset mails of an email within a quarter of an hour, each link replacing the ones before; the fourth answers 429 rate-limited and sends nothing', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])

    for (let n = 1; n <= 3; n += 1) {
      expect((await mounted.act(bob.identity, 'reset')).status).toBe(204)
      await mounted.outbox.next(BOB, n)
    }

    // The email's own allowance is spent, whichever address asks.
    expect(
      await mounted.act(bob.identity, 'reset', undefined, mounted.operator, ELSEWHERE),
    ).toEqual({ status: 429, body: { code: 'rate-limited' }, retryAfter: '900' })

    const links = mailsTitled(mounted, BOB, RESET_SUBJECT.en).map(linkToken)
    const setWith = async (token: string | undefined) =>
      mounted.route(
        postTo('/auth/reset-password', { token, password: 'New-pass-word-2' }),
        ELSEWHERE,
      )

    expect(links).toHaveLength(3)
    expect((await setWith(links[0]))?.status).toBe(401)
    expect((await setWith(links[2]))?.status).toBe(200)
  })

  it("charges the email the account has once its turn came: a change confirmed while the reset waited spends the new email's allowance, mails nobody and leaves the old email's untouched", async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])

    expect((await mounted.act(bob.identity, 'email', { email: NEW_EMAIL })).status).toBe(204)

    const confirmation = linkToken(await mounted.outbox.next(NEW_EMAIL))

    // The new email's three reset mails are spent, by requests for it while it had no account.
    for (let n = 0; n < 3; n += 1) {
      expect(mounted.limits.resetMail(ELSEWHERE, NEW_EMAIL).allowed).toBe(true)
    }

    const release = await holdTurn(mounted.turns, bob.identity)
    const asked = turnsAsked(mounted.turns)
    // The confirmation asks for the account's turn first, the operator's reset after it.
    const confirming = mounted.route(
      postTo('/auth/confirm-email', { token: confirmation }),
      ELSEWHERE,
    )

    await vi.waitFor(() => expect(asked(bob.identity)).toBe(1))

    const resetting = mounted.act(bob.identity, 'reset')

    await vi.waitFor(() => expect(asked(bob.identity)).toBe(2))
    release()

    expect((await confirming)?.status).toBe(200)
    expect(await resetting).toEqual({
      status: 429,
      body: { code: 'rate-limited' },
      retryAfter: '900',
    })
    expect(mailsTitled(mounted, NEW_EMAIL, RESET_SUBJECT.en)).toEqual([])
    expect(mailsTitled(mounted, BOB, RESET_SUBJECT.en)).toEqual([])

    // The old email kept its three reset mails.
    for (let n = 0; n < 3; n += 1) {
      expect(mounted.limits.resetMail(ELSEWHERE, BOB).allowed).toBe(true)
    }

    expect(mounted.limits.resetMail(ELSEWHERE, BOB).allowed).toBe(false)
  })

  it("asks for the mail in the account's turn, then in its email's, as the account's own request takes it", async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])
    const release = await holdTurn(mounted.turns, BOB)
    const asked = turnsAsked(mounted.turns)
    const resetting = mounted.act(bob.identity, 'reset')

    await vi.waitFor(() => expect(asked(BOB)).toBe(1))
    expect(asked(bob.identity)).toBe(1)
    expect(mailsTitled(mounted, BOB, RESET_SUBJECT.en)).toEqual([])

    release()

    expect((await resetting).status).toBe(204)
    await mounted.outbox.next(BOB, 1)
  })
})

describe('consoleRoutes: POST /console/accounts/:id/verification', () => {
  it('sends an account whose email is not verified its verification link again, which verifies it and signs the device in', async () => {
    const mounted = await consoleOnMount()
    const bob = await unverifiedBob(mounted)

    expect(await mounted.act(bob, 'verification')).toEqual({
      status: 204,
      body: undefined,
      retryAfter: null,
    })

    const mail = await mounted.outbox.next(BOB, 1)

    expect(mail.subject).toBe(VERIFY_SUBJECT)

    const verified = await mounted.route(verifyRequest(linkToken(mail), 'tablet'), ELSEWHERE)

    expect(verified?.status).toBe(200)

    const { token, user } = signedInAnswer.parse(await verified?.json())

    expect(user.id).toBe(bob)
    expect((await mounted.sessions.read(token)).kind).toBe('session')
    expect((await mounted.card(bob))?.emailVerified).toBe(true)
    expect(mounted.consoleFailures).toEqual([])
  })

  it("asks Better Auth with the email alone, without the operator's credentials", async () => {
    const asked: Array<Promise<unknown>> = []
    const mounted = await consoleOnMount({
      handler: (handle) => (request) => {
        const { pathname } = new URL(request.url)

        asked.push(
          request
            .clone()
            .json()
            .then((body: unknown) => ({
              pathname,
              method: request.method,
              authorization: request.headers.get('authorization'),
              cookie: request.headers.get('cookie'),
              body,
            })),
        )

        return handle(request)
      },
    })
    const bob = await unverifiedBob(mounted)

    expect((await mounted.act(bob, 'verification')).status).toBe(204)
    expect(await Promise.all(asked)).toEqual([
      {
        pathname: '/backend/auth/send-verification-email',
        method: 'POST',
        authorization: null,
        cookie: null,
        body: { email: BOB },
      },
    ])
  })

  it('answers 409 verified-before to an account whose email is verified, sending nothing', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])

    expect(await mounted.act(bob.identity, 'verification')).toEqual({
      status: 409,
      body: { code: 'verified-before' },
      retryAfter: null,
    })
    expect(mounted.outbox.to(BOB)).toHaveLength(1)
  })

  it('takes three verification mails of an email within a quarter of an hour; the fourth answers 429 rate-limited and sends nothing', async () => {
    const mounted = await consoleOnMount()
    const bob = await unverifiedBob(mounted)

    for (let n = 1; n <= 3; n += 1) {
      expect((await mounted.act(bob, 'verification')).status).toBe(204)
      await mounted.outbox.next(BOB, n)
    }

    expect(await mounted.act(bob, 'verification', undefined, mounted.operator, ELSEWHERE)).toEqual({
      status: 429,
      body: { code: 'rate-limited' },
      retryAfter: '900',
    })
    expect(mailsTitled(mounted, BOB, VERIFY_SUBJECT)).toHaveLength(4)
  }, 15_000)
})

describe("consoleRoutes: an operator's reset and verification mails", () => {
  const actions = ['reset', 'verification']

  it.each(actions)(
    'answers %s of an id no account has, and of an id of another form, 404 account-gone',
    async (action) => {
      const mounted = await consoleOnMount()

      for (const id of [identityIdFactory.create(), 'nonsense']) {
        expect(await mounted.act(id, action)).toMatchObject({
          status: 404,
          body: { code: 'account-gone' },
        })
      }
    },
  )

  it.each(actions)(
    'answers %s of an account removed while it waited for its turn 404 account-gone, sending nothing',
    async (action) => {
      const mounted = await consoleOnMount()
      const bob = await unverifiedBob(mounted)
      const release = await holdTurn(mounted.turns, bob)
      const asked = turnsAsked(mounted.turns)
      const acting = mounted.act(bob, action)

      await vi.waitFor(() => expect(asked(bob)).toBe(1))
      ;(await mounted.teardown.remove(bob))._unsafeUnwrap()
      release()

      expect(await acting).toMatchObject({ status: 404, body: { code: 'account-gone' } })
      expect(mounted.outbox.to(BOB)).toHaveLength(1)
    },
  )

  it.each(actions)('answers 405 with POST in Allow to another method at %s', async (action) => {
    const mounted = await consoleOnMount()
    const bob = await unverifiedBob(mounted)
    const answer = await mounted.routes(
      new Request(`http://gateway.test/console/accounts/${bob}/${action}`, {
        headers: {
          Authorization: `Bearer ${mounted.operator.token}`,
          'X-Perch-Device': mounted.operator.device,
        },
      }),
      OPERATOR_ADDRESS,
    )

    expect(answer?.status).toBe(405)
    expect(answer?.headers.get('Allow')).toBe('POST')
  })
})
