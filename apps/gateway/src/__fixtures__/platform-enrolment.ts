/**
 * What the wire of `two-factor.confirm` carries beyond the contract's parameter `code`: the
 * enrolment of the key the sender's second factor started with, which the contract does not name.
 */

import { z } from '@workspace/zod'

import type { Account, Stand } from './stand'

const started = z.object({ enrolment: z.string().min(1) })

/**
 * The enrolment of a key the sender's own enable just made: the factor starts for the sender's
 * account first, so a code reaches the check of the key instead of the answer of a changed
 * enrolment.
 */
export async function enrolmentOf(
  stand: Stand,
  sender: Account,
): Promise<Readonly<Record<string, string>>> {
  const answered = await stand.ask({
    method: 'POST',
    path: '/two-factor/enable',
    as: sender,
    body: { password: sender.password },
  })

  if (answered.status !== 200) {
    throw new Error(`the sender's second factor did not start: ${answered.status}`)
  }

  return { enrolment: started.parse(answered.body).enrolment }
}
