/**
 * The seed catalog: the accounts a stand is seeded with, and the data e2e tests
 * generate from the same presets. Standalone on purpose, so a test runner can
 * import it without the application.
 */

import { err, ok, type Result } from 'neverthrow'

import { isTenantKey } from '@workspace/kernel'
import { z } from '@workspace/zod'

/** Seed data is addressed to this domain only, so the sweep can find all of it. */
export const SEED_EMAIL_DOMAIN = 'example.test'

const AccountPreset = z.strictObject({
  ref: z.string().regex(/^[a-z][a-z0-9-]*$/),
  // The profile refuses an empty name or one over 80 characters; the catalog test
  // checks every preset against the profile's own rule.
  name: z.string().trim().min(1).max(80),
  bio: z.string().trim().min(1),
  locale: z.enum(['en', 'es']),
})

const OrganisationPreset = z.strictObject({
  ref: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** The key of a `demo` seed; a `fresh` seed appends its run id. */
  key: z.string(),
  name: z.string().trim().min(1).max(80),
  /** The account ref that creates the organisation: its administrator. */
  admin: z.string(),
  /** The account refs the administrator invites. */
  members: z.array(z.string()),
})

const Catalog = z.strictObject({
  accounts: z.array(AccountPreset),
  organisations: z.array(OrganisationPreset),
})

export type AccountPreset = z.infer<typeof AccountPreset>

export type OrganisationPreset = z.infer<typeof OrganisationPreset>

export type Catalog = z.infer<typeof Catalog>

export const catalog: Catalog = {
  accounts: [
    { ref: 'ann', name: 'Ann Example', bio: 'Demo account of the seed.', locale: 'en' },
    { ref: 'beto', name: 'Beto Ejemplo', bio: 'Cuenta de ejemplo de la semilla.', locale: 'es' },
  ],
  organisations: [{ ref: 'acme', key: 'acme', name: 'Acme Corp', admin: 'ann', members: ['beto'] }],
}

/** `demo`: the same address every run. `fresh`: a new address for each run id. */
export type SeedMode = { readonly kind: 'demo' } | { readonly kind: 'fresh'; readonly run: string }

export interface SeedAccount {
  readonly email: string
  readonly password: string
  readonly name: string
  readonly bio: string
  readonly locale: AccountPreset['locale']
}

export function accountFor(preset: AccountPreset, mode: SeedMode): SeedAccount {
  const mailbox = mode.kind === 'demo' ? preset.ref : `${preset.ref}.${mode.run}`

  return {
    email: `${mailbox}@${SEED_EMAIL_DOMAIN}`,
    password: `${preset.ref}-seed-password`,
    name: preset.name,
    bio: preset.bio,
    locale: preset.locale,
  }
}

export interface SeedOrganisation {
  readonly key: string
  readonly name: string
}

/** The organisation a run seeds: `demo` keeps the preset's key, `fresh` suffixes the run id. */
export function organisationFor(preset: OrganisationPreset, mode: SeedMode): SeedOrganisation {
  return {
    key: mode.kind === 'demo' ? preset.key : `${preset.key}_${mode.run}`,
    name: preset.name,
  }
}

/** Checks a catalog offline: its shape, that every ref is used once, and that organisations name accounts. */
export function validateCatalog(candidate: unknown): Result<Catalog, readonly string[]> {
  const parsed = Catalog.safeParse(candidate)

  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`))
  }

  const { accounts, organisations } = parsed.data
  const refs = accounts.map((preset) => preset.ref)
  const known = new Set(refs)
  const duplicates = [
    ...refs
      .filter((ref, index) => refs.indexOf(ref) !== index)
      .map((ref) => `duplicate ref ${ref}`),
    ...organisations
      .map((preset) => preset.ref)
      .filter((ref, index, all) => all.indexOf(ref) !== index)
      .map((ref) => `duplicate organisation ref ${ref}`),
  ]
  const problems = organisations.flatMap((preset) => [
    ...(known.has(preset.admin)
      ? []
      : [`organisation ${preset.ref}: admin ${preset.admin} is no account`]),
    ...preset.members
      .filter((member) => !known.has(member))
      .map((member) => `organisation ${preset.ref}: member ${member} is no account`),
    ...(isTenantKey(preset.key)
      ? []
      : [`organisation ${preset.ref}: key ${preset.key} is not a tenant key`]),
  ])
  const refused = [...duplicates, ...problems]

  return refused.length > 0 ? err(refused) : ok(parsed.data)
}
