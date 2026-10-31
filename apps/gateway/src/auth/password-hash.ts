/** argon2id with SurrealDB's parameters (m=19456 KiB, t=2), so hashes of either side verify on the other. */
const ARGON2ID = { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 } as const

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, ARGON2ID)
}

export function verifyPassword(input: {
  readonly password: string
  readonly hash: string
}): Promise<boolean> {
  return Bun.password.verify(input.password, input.hash)
}
