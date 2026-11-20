import { expect } from 'vitest'

import { CONTRACT_VALUES } from '@workspace/kernel'

import { signInRequest } from './mount'

const { minLength, maxLength } = CONTRACT_VALUES.password

/** Passwords of a length no account's password has, by what they are: each is a wrong one. */
export const OUT_OF_LENGTH = [
  ['an empty password', ''],
  [`a password of ${minLength - 1} characters`, 'p'.repeat(minLength - 1)],
  [`a password of ${maxLength + 1} characters`, 'p'.repeat(maxLength + 1)],
] as const

/** How a spec asks the mounted gateway. */
type Route = (request: Request, from: string) => Promise<Response | undefined>

/**
 * Signs `email` in nine times with a wrong password of an account's length, each refused 401: one
 * failure short of the ten its failed sign-ins allow, so the next failure of any kind spends them.
 */
export async function failNineSignIns(route: Route, email: string, from: string): Promise<void> {
  for (let failed = 0; failed < 9; failed += 1) {
    expect((await route(signInRequest(email, 'Wrong-pass-word-9', 'probe'), from))?.status).toBe(
      401,
    )
  }
}
