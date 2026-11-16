import { describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import {
  holdTurn,
  postTo,
  signedInOn,
  turnsAsked,
} from '../../auth/auth-handler/__fixtures__/mount'
import { linkToken } from '../../mail/__fixtures__/outbox'
import {
  type ConsoleMount,
  consoleOnMount,
  OPERATOR_ADDRESS,
  signedInAs,
} from '../__fixtures__/console-mount'
import { profiledOn } from '../__fixtures__/profiles'

/** The account the operator acts on. */
const BOB = 'bob@example.test'

/** Another account, whose email is taken. */
const CAT = 'cat@example.test'

/** The new email an operator gives bob's account. */
const NEW_EMAIL = 'robert@elsewhere.test'

const MINUTE_MS = 60 * 1000

/** Another client address, which nothing the operator asks charges. */
const ELSEWHERE = '203.0.113.20'

/** Bob signed in on his desk, with his profile, named Bob, on a device subscribed to his region. */
async function bobWithProfile(mounted: ConsoleMount) {
  const bob = await signedInOn(mounted, BOB, ['desk'])
  const device = await profiledOn(mounted.hub, bob.identity, 'Bob', BOB)

  return { bob, device }
}

/** The confirmation of a new email with the link's `token`, as the new mailbox opens it. */
const confirm = (mounted: ConsoleMount, token: string) =>
  mounted.route(postTo('/auth/confirm-email', { token }), ELSEWHERE)

describe('consoleRoutes: POST /console/accounts/:id/rename', () => {
  it("names the account's profile as given, trimmed, through its private region, which its devices see", async () => {
    const mounted = await consoleOnMount()
    const { bob, device } = await bobWithProfile(mounted)

    expect(await mounted.act(bob.identity, 'rename', { name: '  Robert  ' })).toEqual({
      status: 204,
      body: undefined,
      retryAfter: null,
    })
    expect(await device.nameSeen()).toBe('Robert')
    expect((await mounted.card(bob.identity))?.name).toBe('Robert')
    expect(mounted.consoleFailures).toEqual([])
  })

  it('takes a name of 80 characters once trimmed', async () => {
    const mounted = await consoleOnMount()
    const { bob } = await bobWithProfile(mounted)
    const name = 'r'.repeat(80)

    expect((await mounted.act(bob.identity, 'rename', { name: ` ${name} ` })).status).toBe(204)
    expect((await mounted.card(bob.identity))?.name).toBe(name)
  })

  it.each([
    { name: '', code: 'name-required' },
    { name: '   ', code: 'name-required' },
    { name: 'r'.repeat(81), code: 'name-too-long' },
  ])('refuses the name "$name" 400 $code, writing nothing', async ({ name, code }) => {
    const mounted = await consoleOnMount()
    const { bob, device } = await bobWithProfile(mounted)
    const heard = device.received.length

    expect(await mounted.act(bob.identity, 'rename', { name })).toEqual({
      status: 400,
      body: { code },
      retryAfter: null,
    })
    expect(device.received).toHaveLength(heard)
    expect((await mounted.card(bob.identity))?.name).toBe('Bob')
  })

  it.each([
    { what: 'no body', body: undefined },
    { what: 'a body that names no name', body: {} },
    { what: 'a name that is no text', body: { name: 7 } },
    { what: 'a body that is not JSON', body: 'not json' },
  ])('answers 400 bad-request to $what', async ({ body }) => {
    const mounted = await consoleOnMount()
    const { bob } = await bobWithProfile(mounted)

    expect(await mounted.act(bob.identity, 'rename', body)).toMatchObject({
      status: 400,
      body: { code: 'bad-request' },
    })
  })

  it('answers 409 failed to an account that has no profile yet, writing nothing', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])

    expect(await mounted.act(bob.identity, 'rename', { name: 'Robert' })).toEqual({
      status: 409,
      body: { code: 'failed' },
      retryAfter: null,
    })
    expect(await mounted.card(bob.identity)).toMatchObject({ hasProfile: false, name: 'Ann' })
    expect(mounted.consoleFailures).toEqual([])
  })

  it("renames in the account's turn, after the work asked of the account before it", async () => {
    const mounted = await consoleOnMount()
    const { bob, device } = await bobWithProfile(mounted)
    const release = await holdTurn(mounted.turns, bob.identity)
    const asked = turnsAsked(mounted.turns)
    const renaming = mounted.act(bob.identity, 'rename', { name: 'Robert' })

    await vi.waitFor(() => expect(asked(bob.identity)).toBe(1))
    expect((await mounted.card(bob.identity))?.name).toBe('Bob')

    release()

    expect((await renaming).status).toBe(204)
    expect(await device.nameSeen()).toBe('Robert')
  })
})

describe('consoleRoutes: POST /console/accounts/:id/email', () => {
  it('mails the new email its confirmation link, the account keeping its email until it is opened', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])

    expect(
      await mounted.act(bob.identity, 'email', { email: `  ${NEW_EMAIL.toUpperCase()} ` }),
    ).toEqual({
      status: 204,
      body: undefined,
      retryAfter: null,
    })

    const mail = await mounted.outbox.next(NEW_EMAIL)
    const link = new URL(/https?:\/\/\S+/.exec(mail.text)?.[0] ?? expect.unreachable('a link'))

    expect(mail.subject).toBe('Confirm your new email for Perch')
    expect(link.origin + link.pathname).toBe('http://localhost/confirm-email')
    expect(await mounted.identityOf(BOB)).toBe(bob.identity)
    expect(mounted.consoleFailures).toEqual([])
  })

  it('changes the email once the link is opened: verified, signing the account in, the old email told', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])

    expect((await mounted.act(bob.identity, 'email', { email: NEW_EMAIL })).status).toBe(204)
    expect((await confirm(mounted, linkToken(await mounted.outbox.next(NEW_EMAIL))))?.status).toBe(
      200,
    )
    expect(await mounted.card(bob.identity)).toMatchObject({
      email: NEW_EMAIL,
      emailVerified: true,
    })
    // The verification mail, then the notice of the change.
    expect((await mounted.outbox.next(BOB, 1)).subject).toBe('Your Perch account has a new email')
  })

  it('replaces the link of an earlier change, asked for by the account itself or by an operator', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])
    // The account's own request keeps its change as this one does.
    const own = (
      await mounted.emailChanges.ask(bob.identity, BOB, 'own-choice@example.test')
    )._unsafeUnwrap()

    expect((await mounted.act(bob.identity, 'email', { email: 'first@example.test' })).status).toBe(
      204,
    )

    const first = linkToken(await mounted.outbox.next('first@example.test'))

    expect((await mounted.act(bob.identity, 'email', { email: NEW_EMAIL })).status).toBe(204)

    const second = linkToken(await mounted.outbox.next(NEW_EMAIL))

    for (const replaced of [own, first]) {
      const refused = await confirm(mounted, replaced)

      expect(refused?.status).toBe(401)
      expect(await refused?.json()).toEqual({ code: 'link-invalid' })
    }

    expect((await confirm(mounted, second))?.status).toBe(200)
    expect(await mounted.identityOf(NEW_EMAIL)).toBe(bob.identity)
  })

  it.each([
    { what: 'an empty email', email: '' },
    { what: 'a text that is no email', email: 'robert' },
    { what: 'an email over 320 characters', email: `${'r'.repeat(310)}@example.test` },
  ])(
    "refuses $what 400 email-invalid, mailing nothing and taking none of the account's changes",
    async ({ email }) => {
      const mounted = await consoleOnMount()
      const bob = await signedInOn(mounted, BOB, ['desk'])
      const sent = mounted.outbox.sent.length

      expect(await mounted.act(bob.identity, 'email', { email })).toEqual({
        status: 400,
        body: { code: 'email-invalid' },
        retryAfter: null,
      })
      expect(mounted.outbox.sent).toHaveLength(sent)
      // The account's three changes in a quarter of an hour are all still there.
      expect(mounted.limits.emailChangeMail(ELSEWHERE, bob.identity).allowed).toBe(true)
      expect(mounted.limits.emailChangeMail(ELSEWHERE, bob.identity).allowed).toBe(true)
      expect(mounted.limits.emailChangeMail(ELSEWHERE, bob.identity).allowed).toBe(true)
    },
  )

  it.each([
    { what: 'an email another account holds', email: CAT },
    { what: 'an email another account holds, in another case', email: CAT.toUpperCase() },
    { what: "the account's own email", email: BOB },
  ])(
    'answers $what 409 email-taken, mailing nothing and keeping the earlier change',
    async ({ email }) => {
      const mounted = await consoleOnMount()
      const bob = await signedInOn(mounted, BOB, ['desk'])

      await signedInOn(mounted, CAT, ['tablet'])

      const earlier = (
        await mounted.emailChanges.ask(bob.identity, BOB, 'own-choice@example.test')
      )._unsafeUnwrap()
      const sent = mounted.outbox.sent.length

      expect(await mounted.act(bob.identity, 'email', { email })).toEqual({
        status: 409,
        body: { code: 'email-taken' },
        retryAfter: null,
      })
      expect(mounted.outbox.sent).toHaveLength(sent)
      expect((await confirm(mounted, earlier))?.status).toBe(200)
    },
  )

  it('takes three changes of the account within a quarter of an hour; the fourth answers 429 rate-limited and mails nothing', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])

    for (let n = 0; n < 3; n += 1) {
      expect(
        (await mounted.act(bob.identity, 'email', { email: `n${n}@example.test` })).status,
      ).toBe(204)
    }

    // Another operator's address changes nothing: the account's own allowance is spent.
    const limited = await mounted.act(
      bob.identity,
      'email',
      { email: NEW_EMAIL },
      mounted.operator,
      ELSEWHERE,
    )

    expect(limited).toEqual({ status: 429, body: { code: 'rate-limited' }, retryAfter: '900' })
    expect(mounted.outbox.to(NEW_EMAIL)).toEqual([])

    await mounted.clock.advance(15 * MINUTE_MS)

    expect((await mounted.act(bob.identity, 'email', { email: NEW_EMAIL })).status).toBe(204)
  })

  it("asks for the change in the account's turn, after the work asked of the account before it", async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])
    const release = await holdTurn(mounted.turns, bob.identity)
    const asked = turnsAsked(mounted.turns)
    const changing = mounted.act(bob.identity, 'email', { email: NEW_EMAIL })

    await vi.waitFor(() => expect(asked(bob.identity)).toBe(1))
    expect(mounted.outbox.to(NEW_EMAIL)).toEqual([])

    release()

    expect((await changing).status).toBe(204)
    await mounted.outbox.next(NEW_EMAIL)
  })

  it('answers 400 bad-request to a body that names no email', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])

    expect(await mounted.act(bob.identity, 'email', { name: 'Robert' })).toMatchObject({
      status: 400,
      body: { code: 'bad-request' },
    })
  })
})

describe("consoleRoutes: an operator's rename and change of email", () => {
  const asks = [
    { action: 'rename', body: { name: 'Robert' } },
    { action: 'email', body: { email: NEW_EMAIL } },
  ]

  it.each(asks)(
    'answers $action of an id no account has, and of an id of another form, 404 account-gone',
    async ({ action, body }) => {
      const mounted = await consoleOnMount()

      for (const id of [identityIdFactory.create(), 'nonsense']) {
        expect(await mounted.act(id, action, body)).toMatchObject({
          status: 404,
          body: { code: 'account-gone' },
        })
      }

      expect(mounted.outbox.to(NEW_EMAIL)).toEqual([])
    },
  )

  it.each(asks)(
    'answers $action of an account removed while it waited for its turn 404 account-gone',
    async ({ action, body }) => {
      const mounted = await consoleOnMount()
      const { bob } = await bobWithProfile(mounted)
      const release = await holdTurn(mounted.turns, bob.identity)
      const asked = turnsAsked(mounted.turns)
      const acting = mounted.act(bob.identity, action, body)

      await vi.waitFor(() => expect(asked(bob.identity)).toBe(1))
      ;(await mounted.teardown.remove(bob.identity))._unsafeUnwrap()
      release()

      expect(await acting).toMatchObject({ status: 404, body: { code: 'account-gone' } })
      expect(mounted.outbox.to(NEW_EMAIL)).toEqual([])
    },
  )

  it.each(asks)(
    'refuses $action by an account that is no operator 403 not-operator',
    async ({ action, body }) => {
      const mounted = await consoleOnMount()
      const { bob } = await bobWithProfile(mounted)
      const cat = await signedInOn(mounted, CAT, ['tablet'])

      expect(
        await mounted.act(
          bob.identity,
          action,
          body,
          signedInAs(cat, CAT, 'tablet'),
          OPERATOR_ADDRESS,
        ),
      ).toMatchObject({ status: 403, body: { code: 'not-operator' } })
      expect((await mounted.card(bob.identity))?.name).toBe('Bob')
      expect(mounted.outbox.to(NEW_EMAIL)).toEqual([])
    },
  )
})
