/**
 * Test data from the seed catalog's presets: fresh addresses on the seed domain
 * for every call, so tests never share an account. ASCII only.
 */

import { randomUUID } from 'node:crypto'

import { accountFor, catalog, SEED_EMAIL_DOMAIN, type SeedAccount } from '@workspace/seed/catalog'

const [preset] = catalog.accounts
const [organisation] = catalog.organisations

const run = (): string => randomUUID().slice(0, 8)

export const generate = {
  account: (): SeedAccount =>
    accountFor(preset ?? { ref: 'e2e', name: 'E2E User', bio: 'E2E account.', locale: 'en' }, {
      kind: 'fresh',
      run: run(),
    }),
  email: (): string => generate.account().email,
  /** Another fresh address, for an account's second email or another account. */
  newEmail: (): string => generate.email(),
  otherEmail: (): string => generate.email(),
  /** The email of the account a test makes an operator of the platform. */
  operatorEmail: (): string => generate.email(),
  /**
   * The start of the local part of a group of fresh emails, its own for every call: a search by it
   * finds the emails `emailStartingWith` makes with it, and no other account.
   */
  emailPrefix: (): string => `${preset?.ref ?? 'e2e'}.${run()}`,
  /** The `n`th email of the group whose local part starts with `prefix`. */
  emailStartingWith: (prefix: string, n: number): string => `${prefix}-${n}@${SEED_EMAIL_DOMAIN}`,
  password: (): string => generate.account().password,
  /** A password of its own for every call, unlike `password`, which every account shares. */
  otherPassword: (): string => `Other-password-1-${run()}`,
  /** A password of its own for every call that keeps the rules, for an account's next one. */
  newPassword: (): string => `New-password-1-${run()}`,
  /** A password of its own for every call that no account has. */
  wrongPassword: (): string => `Wrong-password-1-${run()}`,
  name: (): string => `${preset?.name ?? 'E2E User'} ${run()}`,
  otherName: (): string => generate.name(),
  operatorName: (): string => generate.name(),
  newName: (): string => `Renamed ${run()}`,
  /** Why an operator bans an account, its own for every call. */
  reason: (): string => `Banned in run ${run()}`,
  bio: (): string => `Bio written in run ${run()}`,
  /** An organisation key of its own for every call: `e2e_` and 8 lowercase hex digits. */
  tenantKey: (): string => `e2e_${run()}`,
  organisationName: (): string => `${organisation?.name ?? 'E2E Organisation'} ${run()}`,
  noteText: (): string => `Note written in run ${run()}`,
}
