/**
 * The rows of `verification` a reclaim of expired ceremonies meets, written straight into a
 * directory as Better Auth and the gateway write them, and read back by their identifiers.
 */

import { fromDriverValue, type LocalDb } from '@workspace/data'
import { z } from '@workspace/zod'

import verificationRowStatement from './verification-row.surql'
import verificationRowsStatement from './verification-rows.surql'

const MINUTE_MS = 60 * 1000

/** A row of `verification` as a spec writes it: its identifier, its value, minutes to its expiry. */
export interface VerificationRow {
  readonly identifier: string
  readonly value: string
  /** Minutes from now to its expiry: negative for a row that expired that long ago. */
  readonly expiresInMinutes: number
}

/** The options of a passkey's registration (`registration`) or sign-in, as the plugin keeps them. */
export const passkeyCeremony = (
  identifier: string,
  type: 'registration' | 'authentication',
  expiresInMinutes: number,
): VerificationRow => ({
  identifier,
  value: JSON.stringify({ type, expectedChallenge: `challenge-of-${identifier}` }),
  expiresInMinutes,
})

/**
 * A password step's challenge (`2fa-<random>`, the identity's key as its value) and the row
 * counting its codes (`2fa-attempts-2fa-<random>`), expiring together as Better Auth writes them.
 */
export const twoFactorChallenge = (
  random: string,
  expiresInMinutes: number,
): readonly [VerificationRow, VerificationRow] => [
  { identifier: `2fa-${random}`, value: 'identity-key', expiresInMinutes },
  { identifier: `2fa-attempts-2fa-${random}`, value: '0', expiresInMinutes },
]

/**
 * A row of every kind no reclaim touches, expired an hour ago: a reset link, a pending change of
 * an email and a pending deletion of an account, which must still read as expired.
 */
export const keptRows = (suffix: string): readonly VerificationRow[] => [
  { identifier: `reset-password:token-${suffix}`, value: 'identity-key', expiresInMinutes: -60 },
  { identifier: `change-email:identity-${suffix}`, value: `jti-${suffix}`, expiresInMinutes: -60 },
  {
    identifier: `delete-account:identity-${suffix}`,
    value: `jti-${suffix}`,
    expiresInMinutes: -60,
  },
]

/** Writes `rows` into `local`'s `verification`. */
export async function written(local: LocalDb, rows: readonly VerificationRow[]): Promise<void> {
  for (const { identifier, value, expiresInMinutes } of rows) {
    await local.db.query(verificationRowStatement, {
      identifier,
      value,
      expires_at: new Date(Date.now() + expiresInMinutes * MINUTE_MS),
    })
  }
}

const identifierRows = z.array(z.object({ identifier: z.string() }))

/** The identifiers of every row of `local`'s `verification`, sorted. */
export async function identifiersIn(local: LocalDb): Promise<string[]> {
  const [rows] = await local.db.query<[unknown]>(verificationRowsStatement)

  return identifierRows
    .parse(fromDriverValue(rows))
    .map(({ identifier }) => identifier)
    .sort()
}

/** The identifiers of `rows`, sorted. */
export const identifiersOf = (rows: readonly VerificationRow[]): string[] =>
  rows.map(({ identifier }) => identifier).sort()
