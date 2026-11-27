/**
 * What the wire of `confirm-sign-in` carries beyond the contract's parameters: the challenge of a
 * password step and the email typed at it, which the contract does not name.
 */

import { z } from '@workspace/zod'

import { codeOf, keyOf } from '../auth/__fixtures__/second-factor'

import type { Account, Stand } from './stand'

const started = z.object({ uri: z.string().min(1), enrolment: z.string().min(1) })

const asked = z.object({ secondFactor: z.object({ challenge: z.string().min(1) }) })

/**
 * The challenge of a fresh password step of the sender's account, and the sender's email as it
 * signed up: the account's second factor is turned on first (a key, confirmed by its code), so its
 * right password answers a challenge, which a code then reaches the check of.
 */
export async function challengeOf(
  stand: Stand,
  sender: Account,
): Promise<Readonly<Record<string, string>>> {
  const enabled = await stand.ask({
    method: 'POST',
    path: '/two-factor/enable',
    as: sender,
    body: { password: sender.password },
  })

  if (enabled.status !== 200) {
    throw new Error(`the sender's second factor did not start: ${enabled.status}`)
  }

  const { uri, enrolment } = started.parse(enabled.body)
  const confirmed = await stand.ask({
    method: 'POST',
    path: '/two-factor/confirm',
    as: sender,
    body: { code: await codeOf(keyOf(uri)), enrolment },
  })

  if (confirmed.status !== 204) {
    throw new Error(`the sender's second factor did not turn on: ${confirmed.status}`)
  }

  const step = await stand.ask({
    method: 'POST',
    path: '/auth/sign-in/email',
    device: sender.device,
    body: { email: sender.email, password: sender.password },
  })

  if (step.status !== 200) {
    throw new Error(`the sender's password step answered no challenge: ${step.status}`)
  }

  return { challenge: asked.parse(step.body).secondFactor.challenge, email: sender.email }
}
