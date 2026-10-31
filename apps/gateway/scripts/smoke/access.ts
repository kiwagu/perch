/**
 * The credential steps of the smoke test, each from a device, so a simulated client address, of
 * its own: the limit of sign-ins per client address, the limit of failed sign-ins per email, and
 * a sign-up of an email that already has an account.
 */

import { z } from '@workspace/zod'

import { type Answer, type Credentials, call, postCredentials } from './http'
import { check, step } from './steps'

/** The answer of the gateway's limit that refused a request. */
const rateLimited = z.object({ code: z.literal('rate-limited') })

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
  return { email: `smoke-${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() }
}

/**
 * The credential steps: 20 sign-ins per client address within 10 s (sign-ins of unknown emails,
 * so no email's own limit counts), 10 failed sign-ins per email, each limit answering
 * `rate-limited` with `Retry-After`, and a sign-up of an email that has an account, refused 422
 * without a session.
 */
export async function accessSteps(base: string): Promise<void> {
  await step(
    '21 sign-ins of unknown emails from one address within 10 s: the 21st answers 429 with Retry-After',
    async () => {
      const device = { id: 'smoke-device-unknown-emails', label: 'Smoke' }

      checkLimited(await signIns(base, device, 21, freshAccount), 401)
    },
  )

  await step('11 wrong passwords for one email: the 11th answers 429', async () => {
    const device = { id: 'smoke-device-wrong-passwords', label: 'Smoke' }
    const { identity } = await postCredentials(base, '/auth/sign-up/email', {
      ...freshAccount(),
      device,
    })
    const last = checkLimited(
      await signIns(base, device, 11, () => ({
        email: identity.email,
        password: crypto.randomUUID(),
      })),
      401,
    )

    check(rateLimited.safeParse(last?.body).success, `the last said ${JSON.stringify(last?.body)}`)
  })

  await step('a sign-up of a taken email answers 422', async () => {
    const account = freshAccount()

    await postCredentials(base, '/auth/sign-up/email', {
      ...account,
      device: { id: 'smoke-device-taken-email-1', label: 'Smoke' },
    })

    const again = await call(
      base,
      'POST',
      '/auth/sign-up/email',
      undefined,
      { name: 'Smoke', ...account },
      { id: 'smoke-device-taken-email-2', label: 'Smoke' },
    )

    // The status only: an answer that let the sign-up through would carry a session token.
    check(again.status === 422, `answered ${again.status}`)
  })
}
