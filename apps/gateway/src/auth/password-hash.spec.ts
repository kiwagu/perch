import { describe, expect, it } from 'vitest'

import { hashPassword, verifyPassword } from './password-hash'

describe('password hashing', () => {
  it('hashes with argon2id and verifies the hash', async () => {
    const hash = await hashPassword('pass-word-1')

    // SurrealDB's own cost (19456 KiB, two passes, one lane): a cheaper hash fails here.
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true)
    expect(await verifyPassword({ password: 'pass-word-1', hash })).toBe(true)
    expect(await verifyPassword({ password: 'pass-word-2', hash })).toBe(false)
  })

  it("verifies a hash SurrealDB's crypto::argon2::generate made", async () => {
    // Made once with `RETURN crypto::argon2::generate('pass-word-1')` on SurrealDB 3.3.4.
    const surreal =
      '$argon2id$v=19$m=19456,t=2,p=1$1ztTzdwoQX7nUaCi8TWdaQ$IFM4dYMm37DaAuvjyl5cHtOWHOxD20TjNUm6Q2Rldt4'

    expect(await verifyPassword({ password: 'pass-word-1', hash: surreal })).toBe(true)
  })
})
