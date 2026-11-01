import { describe, expect, it, vi } from 'vitest'

import { CLOSE } from '@workspace/replica/protocol'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { deviceHeaders } from '../__fixtures__/auth-instance'

import {
  ANN,
  mountedOnFakeAuth,
  mountedOnRealAuth,
  PASSWORD,
  pastFloor,
  postTo,
  printedDuring,
  resendRequest,
  signedInOn,
  signInRequest,
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
    expect((await mounted.route(reset(second), FROM))?.status).toBe(204)
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

    expect(answer?.status).toBe(204)
    expect(await answer?.text()).toBe('')

    for (const device of ['laptop', 'phone']) {
      expect(await mounted.sessions.read(ann.tokens.get(device) ?? '')).toEqual({ kind: 'none' })
      expect(ann.sockets.get(device)?.ended).toEqual([CLOSE.passwordChanged])
    }

    expect(mounted.closes).toEqual([[ann.identity, undefined, CLOSE.passwordChanged]])
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'laptop'), FROM))?.status).toBe(401)
    expect((await mounted.route(signInRequest(ANN, NEW_PASSWORD, 'laptop'), FROM))?.status).toBe(
      200,
    )
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

    expect((await mounted.route(reset(token), FROM))?.status).toBe(204)

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

    expect(answers.map((answer) => answer?.status).sort()).toEqual([204, 401])
  })

  it('ends every other reset link and the pending change of the email', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const token = await resetLink(mounted)
    const change = (
      await mounted.emailChanges.ask(ann.identity, ANN, 'ann.new@example.test')
    )._unsafeUnwrap()
    const claims = (await mounted.emailChanges.read(change))._unsafeUnwrap()

    expect((await mounted.route(reset(token), FROM))?.status).toBe(204)
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

    expect((await mounted.route(reset(token), FROM))?.status).toBe(204)
  })

  it('refuses a password that breaks the rules with password-rejected, keeping the link and the old password', async () => {
    const mounted = await mountedOnRealAuth()

    await signedInOn(mounted, ANN, ['laptop'])

    const token = await resetLink(mounted)
    const weak = await mounted.route(reset(token, 'abcdefghij'), FROM)

    expect(weak?.status).toBe(400)
    expect(await weak?.json()).toEqual({ code: 'password-rejected' })
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'laptop'), FROM))?.status).toBe(200)
    expect((await mounted.route(reset(token), FROM))?.status).toBe(204)
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
    query: { token: linkToken(await mounted.outbox.next(ANN, seen)) },
    headers: deviceHeaders('laptop'),
  })
}
