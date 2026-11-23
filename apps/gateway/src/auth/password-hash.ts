import { NO_ACCOUNTS_PASSWORD } from './password-length'

/** argon2id with SurrealDB's parameters (m=19456 KiB, t=2), so hashes of either side verify on the other. */
const ARGON2ID = { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 } as const

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, ARGON2ID)
}

/**
 * Whether `password` is the one `hash` was made of. `NO_ACCOUNTS_PASSWORD` never is: a sign-in
 * hands Better Auth that stand-in in place of a password of no account's length, so it must not
 * match a stored hash, even one that was made of it. The hash is still verified before the answer,
 * so the refusal takes as long as a wrong password's.
 */
export async function verifyPassword(input: {
  readonly password: string
  readonly hash: string
}): Promise<boolean> {
  const matches = await Bun.password.verify(input.password, input.hash)

  return matches && input.password !== NO_ACCOUNTS_PASSWORD
}
