/**
 * Test data from the seed catalog's presets: fresh addresses on the seed domain
 * for every call, so tests never share an account. ASCII only.
 */

import { randomUUID } from 'node:crypto'

import { accountFor, catalog, type SeedAccount } from '@workspace/seed/catalog'

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
  password: (): string => generate.account().password,
  name: (): string => `${preset?.name ?? 'E2E User'} ${run()}`,
  newName: (): string => `Renamed ${run()}`,
  bio: (): string => `Bio written in run ${run()}`,
  /** An organisation key of its own for every call: `e2e_` and 8 lowercase hex digits. */
  tenantKey: (): string => `e2e_${run()}`,
  organisationName: (): string => `${organisation?.name ?? 'E2E Organisation'} ${run()}`,
  noteText: (): string => `Note written in run ${run()}`,
}
