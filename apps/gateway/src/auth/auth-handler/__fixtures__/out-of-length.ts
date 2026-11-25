import { expect } from 'vitest'

import { CONTRACT_VALUES } from '@workspace/kernel'

import { CREDENTIAL_CHECKS, FAILED_SIGN_INS } from '../../../limits/windows'

import { signInRequest } from './mount'

const { minLength, maxLength } = CONTRACT_VALUES.password

/** Passwords of a length no account's password has, by what they are: each is a wrong one. */
export const OUT_OF_LENGTH = [
  ['an empty password', ''],
  [`a password of ${minLength - 1} characters`, 'p'.repeat(minLength - 1)],
  [`a password of ${maxLength + 1} characters`, 'p'.repeat(maxLength + 1)],
] as const

/**
 * The specs that spend an email's failed sign-ins from one address count on that address's
 * credential checks outlasting them by a few requests (the sign-in, a right password, a refusal),
 * so the email's limit, not the address's, answers their last request: past that margin they fail
 * here rather than pass on the other limit's 429.
 */
export function expectEmailLimitFirst(): void {
  expect(CREDENTIAL_CHECKS.limit).toBeGreaterThanOrEqual(FAILED_SIGN_INS.limit + 4)
}

/** How a spec asks the mounted gateway. */
type Route = (request: Request, from: string) => Promise<Response | undefined>

/**
 * Signs `email` in with a wrong password of an account's length, each refused 401, until it is one
 * failure short of the failed sign-ins it is allowed (`FAILED_SIGN_INS`), so the next failure of
 * any kind spends them.
 */
export async function failAllButLastSignIn(
  route: Route,
  email: string,
  from: string,
): Promise<void> {
  expectEmailLimitFirst()

  for (let failed = 0; failed < FAILED_SIGN_INS.limit - 1; failed += 1) {
    expect((await route(signInRequest(email, 'Wrong-pass-word-9', 'probe'), from))?.status).toBe(
      401,
    )
  }
}
