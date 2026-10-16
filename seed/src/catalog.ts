/**
 * The seed catalog: the accounts a stand is seeded with, and the data e2e tests
 * generate from the same presets. Standalone on purpose, so a test runner can
 * import it without the application.
 */

import { err, ok, type Result } from 'neverthrow'

import { z } from '@workspace/zod'

/** Seed data is addressed to this domain only, so the sweep can find all of it. */
export const SEED_EMAIL_DOMAIN = 'example.test'

const AccountPreset = z.strictObject({
  ref: z.string().regex(/^[a-z][a-z0-9-]*$/),
  // The profile refuses an empty name or one over 80 characters; the catalog test
  // checks every preset against the profile's own rule.
  name: z.string().trim().min(1).max(80),
  locale: z.enum(['en', 'es']),
})

const Catalog = z.strictObject({ accounts: z.array(AccountPreset) })

export type AccountPreset = z.infer<typeof AccountPreset>

export type Catalog = z.infer<typeof Catalog>

export const catalog: Catalog = {
  accounts: [
    { ref: 'ann', name: 'Ann Example', locale: 'en' },
    { ref: 'beto', name: 'Beto Ejemplo', locale: 'es' },
  ],
}

/** `demo`: the same address every run. `fresh`: a new address for each run id. */
export type SeedMode = { readonly kind: 'demo' } | { readonly kind: 'fresh'; readonly run: string }

export interface SeedAccount {
  readonly email: string
  readonly password: string
  readonly name: string
  readonly locale: AccountPreset['locale']
}

export function accountFor(preset: AccountPreset, mode: SeedMode): SeedAccount {
  const mailbox = mode.kind === 'demo' ? preset.ref : `${preset.ref}.${mode.run}`

  return {
    email: `${mailbox}@${SEED_EMAIL_DOMAIN}`,
    password: `${preset.ref}-seed-password`,
    name: preset.name,
    locale: preset.locale,
  }
}

/** Checks a catalog offline: its shape, and that every ref is used once. */
export function validateCatalog(candidate: unknown): Result<Catalog, readonly string[]> {
  const parsed = Catalog.safeParse(candidate)

  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`))
  }

  const refs = parsed.data.accounts.map((preset) => preset.ref)
  const duplicates = refs.filter((ref, index) => refs.indexOf(ref) !== index)

  return duplicates.length > 0
    ? err(duplicates.map((ref) => `duplicate ref ${ref}`))
    : ok(parsed.data)
}
