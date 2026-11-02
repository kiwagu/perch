/**
 * The reset steps of the smoke test: a request for a reset mail answered alike for an email that
 * has an account and one that has none, and the round-trip of the reset link through the mail in
 * the stand's mailbox, which sets a new password and signs every device of the account out.
 */

import { firstLink, type Mailbox } from '@workspace/mailbox'
import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { freshPassword } from './fresh-password'
import { type Answer, call, postCredentials, signUp } from './http'
import { reported } from './reported-answer'
import { check, hello, type Opened, refusedHello, step } from './steps'

/** A device of its own, so a simulated client address of its own, for these steps. */
function deviceNamed(id: string) {
  return { id: `smoke-device-${id}`, label: 'Smoke' }
}

/**
 * The token of the reset link a mail carries, once its first link opens the front's
 * /reset-password; its failures name nothing of the link.
 */
function resetToken(mail: Parameters<typeof firstLink>[0]): string {
  const url = URL.parse(firstLink(mail))
  const token = url?.searchParams.get('token') ?? ''

  check(url?.pathname === '/reset-password', 'the link does not open /reset-password')
  check(token !== '', 'the link carries no token')

  return token
}

/** Asks for a reset mail to `email`, from `device`. */
function requestReset(base: string, email: string, device: string): Promise<Answer> {
  return call(base, 'POST', '/auth/request-password-reset', undefined, { email }, device)
}

/** Sets `password` with the reset link's `token`, from `device`. */
function reset(base: string, token: string, password: string, device: string): Promise<Answer> {
  return call(base, 'POST', '/auth/reset-password', undefined, { token, password }, device)
}

/** Signs `email` in with `password` from `device`: the answer, as the device got it. */
function signIn(base: string, email: string, password: string, device: string): Promise<Answer> {
  return call(base, 'POST', '/auth/sign-in/email', undefined, { email, password }, device)
}

/**
 * On a fresh identity verified on a laptop and signed in on a phone, whose socket is open: a
 * request for a reset mail answers 202 with no body for it and for an unknown email, mailing it
 * only; the link of the mail sets a new password (204), which closes the phone's socket with 4002
 * and refuses its token at hello, refuses the old password and signs in with the new one, and
 * mails the notice of a changed password; the same link again answers 401 `link-invalid`.
 */
export async function passwordResetSteps(
  base: string,
  mailbox: Mailbox,
  opened: Opened,
): Promise<void> {
  const account = { email: `smoke-${crypto.randomUUID()}@example.test`, password: freshPassword() }
  const unknown = `smoke-${crypto.randomUUID()}@example.test`
  const laptop = deviceNamed('reset-laptop')
  const phone = deviceNamed('reset-phone')

  const { signedIn, socket, seen } = await step(
    'a fresh identity verified on a laptop, signed in on a phone welcomed at its hello',
    async () => {
      await signUp(base, mailbox, { ...account, device: laptop })

      const onPhone = await postCredentials(base, '/auth/sign-in/email', {
        ...account,
        device: phone,
      })
      const { device } = await hello(base, opened, onPhone)

      return { signedIn: onPhone, socket: device, seen: await mailbox.count(account.email) }
    },
  )

  await step(
    'a reset request answers 202 with no body for a known and an unknown email, and mails the known one only',
    async () => {
      const [known, other] = await Promise.all([
        requestReset(base, account.email, laptop.id),
        requestReset(base, unknown, deviceNamed('reset-unknown').id),
      ])

      check(known.status === 202 && known.body === undefined, `known: ${reported(known)}`)
      check(other.status === 202 && other.body === undefined, `unknown: ${reported(other)}`)
      await mailbox.next(account.email, seen)
      check((await mailbox.count(unknown)) === 0, 'the unknown email was mailed')
    },
  )

  const password = freshPassword()
  const token = await step('the reset mail links to /reset-password with a token', async () =>
    resetToken(await mailbox.next(account.email, seen)),
  )

  await step(
    `the reset link sets a new password: 204, the phone closed with ${CLOSE.passwordChanged} and its token refused, the old password refused, the notice mailed`,
    async () => {
      const answer = await reset(base, token, password, laptop.id)

      check(answer.status === 204, `answered ${reported(answer)}`)

      const { code } = await socket.closed

      check(code === CLOSE.passwordChanged, `the phone closed with ${code}`)

      const again = await refusedHello(base, opened, signedIn)

      check(again.code === CLOSE.unauthorized, `the phone's hello closed with ${again.code}`)

      const old = await signIn(base, account.email, account.password, laptop.id)

      check(old.status === 401, `the old password answered ${old.status}`)

      const fresh = await signIn(base, account.email, password, laptop.id)

      check(fresh.status === 200, `the new password answered ${fresh.status}`)
      await mailbox.next(account.email, seen + 1)
    },
  )

  await step('the same reset link again answers 401 link-invalid', async () => {
    const again = await reset(base, token, freshPassword(), laptop.id)

    check(
      again.status === 401 &&
        z.object({ code: z.literal('link-invalid') }).safeParse(again.body).success,
      `answered ${reported(again)}`,
    )
  })
}
