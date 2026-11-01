/**
 * The credential steps of the smoke test, each from a device, so a simulated client address, of
 * its own: the limit of sign-ins per client address, the limit of failed sign-ins per email, a
 * sign-up of an email that already has an account, a sign-up whose password breaks the rules of a
 * new password, an unverified account's sign-in, the resend
 * of the verification mail and its limit per email, and the verification of a link.
 */

import type { Mailbox } from '@workspace/mailbox'
import { z } from '@workspace/zod'

import { freshPassword } from './fresh-password'
import { type Answer, type Credentials, call, signUp } from './http'
import { reported } from './reported-answer'
import { check, step } from './steps'

/** The answer of the gateway's limit that refused a request. */
const rateLimited = z.object({ code: z.literal('rate-limited') })

/** The answer to a sign-up whose password breaks the rules of a new password. */
const weakPassword = z.object({ code: z.literal('weak-password') })

/** What a first verification answers, as far as these steps read it. */
const verifiedFirst = z.object({ token: z.string().min(1) })

/** Signs in `count` times one after the other from `device`, each time with `credentials()`. */
async function signIns(
  base: string,
  device: Credentials['device'],
  count: number,
  credentials: () => Pick<Credentials, 'email' | 'password'>,
): Promise<Answer[]> {
  const answers: Answer[] = []

  for (let attempt = 0; attempt < count; attempt += 1) {
    answers.push(await call(base, 'POST', '/auth/sign-in/email', undefined, credentials(), device))
  }

  return answers
}

/**
 * Every answer but the last has `status`; the last is a 429 with a whole number of seconds to
 * wait in `Retry-After`. Answers the last.
 */
function checkLimited(answers: readonly Answer[], status: number): Answer | undefined {
  const before = answers.slice(0, -1).map((answer) => answer.status)
  const last = answers.at(-1)
  const retryAfter = Number(last?.headers.get('Retry-After'))

  check(
    before.every((answered) => answered === status),
    `answered ${before.join(' ')} before the limit`,
  )
  check(last?.status === 429, `the last answered ${last?.status}`)
  check(Number.isInteger(retryAfter) && retryAfter >= 1, `Retry-After ${retryAfter}`)

  return last
}

/** A fresh account on the stand, as a device signs it up. */
function freshAccount(): Pick<Credentials, 'email' | 'password'> {
  return { email: `smoke-${crypto.randomUUID()}@example.test`, password: freshPassword() }
}

/** A device of its own, so a simulated client address of its own, for one step. */
function deviceNamed(id: string): Credentials['device'] {
  return { id: `smoke-device-${id}`, label: 'Smoke' }
}

/** Signs `account` up from `device` without verifying it: the answer, as the device got it. */
function signUpOnly(
  base: string,
  account: Pick<Credentials, 'email' | 'password'>,
  device: Credentials['device'],
): Promise<Answer> {
  return call(
    base,
    'POST',
    '/auth/sign-up/email',
    undefined,
    { name: 'Smoke', ...account, locale: 'en' },
    device,
  )
}

/** Asks for the verification mail of `email` again, from `device`. */
function resend(base: string, email: string, device: Credentials['device']): Promise<Answer> {
  return call(base, 'POST', '/auth/send-verification-email', undefined, { email }, device)
}

/** Exchanges the token of a verification link, from `device` (none names no device). */
function verify(base: string, token: string, device?: Credentials['device']): Promise<Answer> {
  return call(base, 'POST', '/auth/verify-email', undefined, { token }, device)
}

/** Signs `account` in from `device`. */
function signIn(
  base: string,
  account: Pick<Credentials, 'email' | 'password'>,
  device: Credentials['device'],
): Promise<Answer> {
  return call(base, 'POST', '/auth/sign-in/email', undefined, account, device)
}

/** Whether `answer` is the 202 with no body the gateway gives every accepted sign-up and resend. */
function acceptedEmpty(answer: Answer): boolean {
  return answer.status === 202 && answer.body === undefined
}

/**
 * The credential steps: 20 sign-ins per client address within 10 s (sign-ins of unknown emails,
 * so no email's own limit counts), 10 failed sign-ins per email, each limit answering
 * `rate-limited` with `Retry-After`; a sign-up of an email that has an account, answered as a new
 * one and mailed nothing; an unverified account's sign-in refused 403; the resend answered alike
 * for any email and limited per email; and the verification of a link, made up, opened again, or
 * from no device.
 */
export async function accessSteps(base: string, mailbox: Mailbox): Promise<void> {
  await step(
    '21 sign-ins of unknown emails from one address within 10 s: the 21st answers 429 with Retry-After',
    async () => {
      const device = { id: 'smoke-device-unknown-emails', label: 'Smoke' }

      checkLimited(await signIns(base, device, 21, freshAccount), 401)
    },
  )

  await step('11 wrong passwords for one email: the 11th answers 429', async () => {
    const device = { id: 'smoke-device-wrong-passwords', label: 'Smoke' }
    const { identity } = await signUp(base, mailbox, { ...freshAccount(), device })
    const last = checkLimited(
      await signIns(base, device, 11, () => ({
        email: identity.email,
        password: crypto.randomUUID(),
      })),
      401,
    )

    check(
      rateLimited.safeParse(last?.body).success,
      `the last answered ${last === undefined ? 'nothing' : reported(last)}`,
    )
  })

  await step(
    'a sign-up of a taken email answers 202 with no body, as a new one does, and sends it no mail',
    async () => {
      const taken = freshAccount()
      const fresh = freshAccount()

      await signUp(base, mailbox, { ...taken, device: deviceNamed('taken-email-1') })

      const mailed = await mailbox.count(taken.email)
      const [again, other] = await Promise.all([
        signUpOnly(base, taken, deviceNamed('taken-email-2')),
        signUpOnly(base, fresh, deviceNamed('taken-email-3')),
      ])
      const names = (answer: Answer) => [...answer.headers.keys()].sort().join(' ')

      check(acceptedEmpty(again), `the taken email answered ${reported(again)}`)
      check(acceptedEmpty(other), `the new email answered ${reported(other)}`)
      check(names(again) === names(other), 'the two answers carry different headers')
      // The new email's mail went out through the same mailer a taken one's would.
      await mailbox.next(fresh.email, 0)
      check((await mailbox.count(taken.email)) === mailed, 'the taken email was mailed')
    },
  )

  await step('a sign-up whose password breaks the rules answers 400 weak-password', async () => {
    const answer = await signUpOnly(
      base,
      { ...freshAccount(), password: 'abcdefghij' },
      deviceNamed('weak-password'),
    )

    check(
      answer.status === 400 && weakPassword.safeParse(answer.body).success,
      `answered ${reported(answer)}`,
    )
  })

  await step("an unverified account's sign-in answers 403 EMAIL_NOT_VERIFIED", async () => {
    const account = freshAccount()
    const device = deviceNamed('unverified')
    const up = await signUpOnly(base, account, device)

    check(acceptedEmpty(up), `the sign-up answered ${reported(up)}`)

    const answer = await signIn(base, account, device)

    check(
      answer.status === 403 &&
        z.object({ code: z.literal('EMAIL_NOT_VERIFIED') }).safeParse(answer.body).success,
      `answered ${reported(answer)}`,
    )
  })

  await step(
    'a resend answers 202 for an unverified, a verified and an unknown email, and mails the unverified one only',
    async () => {
      const unverified = freshAccount()
      const verified = freshAccount()
      const unknown = freshAccount()
      const device = deviceNamed('resend')
      const [up] = await Promise.all([
        signUpOnly(base, unverified, deviceNamed('resend-unverified')),
        signUp(base, mailbox, { ...verified, device: deviceNamed('resend-verified') }),
      ])

      check(acceptedEmpty(up), `the sign-up answered ${reported(up)}`)
      await mailbox.next(unverified.email, 0)

      const answers = await Promise.all(
        [unverified, verified, unknown].map(({ email }) => resend(base, email, device)),
      )

      check(answers.every(acceptedEmpty), `answered ${answers.map(reported).join(', ')}`)
      await mailbox.next(unverified.email, 1)
      check((await mailbox.count(verified.email)) === 1, 'the verified email was mailed again')
      check((await mailbox.count(unknown.email)) === 0, 'the unknown email was mailed')
    },
  )

  await step(
    'a fourth resend of one email within 15 minutes answers 429 with Retry-After',
    async () => {
      const { email } = freshAccount()
      const device = deviceNamed('resends')
      const answers: Answer[] = []

      for (let attempt = 0; attempt < 4; attempt += 1) {
        answers.push(await resend(base, email, device))
      }

      const last = checkLimited(answers, 202)

      check(
        rateLimited.safeParse(last?.body).success,
        `the last answered ${last === undefined ? 'nothing' : reported(last)}`,
      )
    },
  )

  await step(
    'a verification with a made-up token answers 401 link-invalid; the right one opened again answers token null',
    async () => {
      const account = freshAccount()
      const device = deviceNamed('link')
      const seen = await mailbox.count(account.email)
      const up = await signUpOnly(base, account, device)

      check(acceptedEmpty(up), `the sign-up answered ${reported(up)}`)

      const token = await mailbox.verificationToken(account.email, seen)
      const madeUp = await verify(base, 'made-up-token', device)
      const first = await verify(base, token, device)
      const again = await verify(base, token, deviceNamed('link-again'))

      check(
        madeUp.status === 401 &&
          z.object({ code: z.literal('link-invalid') }).safeParse(madeUp.body).success,
        `the made-up token answered ${reported(madeUp)}`,
      )
      check(
        first.status === 200 && verifiedFirst.safeParse(first.body).success,
        `the first opening answered ${first.status}`,
      )
      check(
        again.status === 200 && JSON.stringify(again.body) === '{"token":null}',
        `the second opening answered ${reported(again)}`,
      )
    },
  )

  await step(
    'a verification that names no device answers 400, and the email stays unverified until one that does',
    async () => {
      const account = freshAccount()
      const device = deviceNamed('no-device')
      const seen = await mailbox.count(account.email)
      const up = await signUpOnly(base, account, device)

      check(acceptedEmpty(up), `the sign-up answered ${reported(up)}`)

      const token = await mailbox.verificationToken(account.email, seen)
      const unnamed = await verify(base, token)

      check(
        unnamed.status === 400 &&
          z.object({ code: z.literal('bad-request') }).safeParse(unnamed.body).success,
        `the verification without a device answered ${reported(unnamed)}`,
      )

      const before = await signIn(base, account, device)

      check(before.status === 403, `the sign-in before the verification answered ${before.status}`)

      const named = await verify(base, token, device)

      check(named.status === 200, `the verification on the device answered ${named.status}`)

      const after = await signIn(base, account, device)

      check(after.status === 200, `the sign-in after the verification answered ${after.status}`)
    },
  )
}
